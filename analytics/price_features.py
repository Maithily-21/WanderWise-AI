"""
Shared feature engineering for the flight price model.

Used by BOTH scripts/train_price_model.py and analytics/price_prediction.py
so training and inference build identical feature frames (same columns,
same order, same encodings).

Dataset facts this module is built around (see data/README.md):
- data/flight_fares.csv is the Kaggle Indian domestic fare dataset:
  prices are INR, journeys are Mar-Jun 2019, and cities are names
  ("Banglore", "New Delhi"), not IATA codes. We map them to IATA so the
  model speaks the same language as tools/location_resolver.py.
- The dataset has no booking date, so there is no real
  "days before departure" signal; the travel date is the only date input.
"""
import re

import numpy as np
import pandas as pd

# Dataset city name -> IATA. "Delhi" and "New Delhi" are the same airport
# (DEL) spelled two ways in the raw data.
CITY_TO_IATA = {
    "banglore": "BLR", "bangalore": "BLR", "bengaluru": "BLR",
    "delhi": "DEL", "new delhi": "DEL",
    "kolkata": "CCU", "mumbai": "BOM", "chennai": "MAA",
    "cochin": "COK", "kochi": "COK", "hyderabad": "HYD",
}

CATEGORICAL = ["origin", "destination", "airline", "additional_info", "via"]
NUMERIC = ["total_stops", "duration_min", "dep_hour", "arr_hour", "overnight",
           "month", "day_of_month", "day_of_week", "day_of_year"]
FEATURES = CATEGORICAL + NUMERIC
TARGET = "price"

# Inputs the app may not know at prediction time. A separate model is
# trained for each tier below, without the columns that tier lacks.
TRIP_DETAIL_FEATURES = ["total_stops", "duration_min", "dep_hour", "additional_info",
                        "arr_hour", "overnight", "via"]
AIRLINE_FEATURES = ["airline"]
CONNECTION_FEATURES = ["via"]  # connecting airports, e.g. "BOM" or "LKO-BOM"; "none" if non-stop

# Input tiers (tier -> columns it does NOT have), most to least informed.
# "route_date" is what the LangGraph app supplies today (airline "unknown").
# Dedicated per-tier models beat one model trained on randomly masked
# copies in grouped CV, so we keep one model per tier.
TIERS = {
    "full": [],
    "trip_details": CONNECTION_FEATURES,
    "route_date_airline": TRIP_DETAIL_FEATURES,
    "route_date": TRIP_DETAIL_FEATURES + AIRLINE_FEATURES,
}

_STOPS = {"non-stop": 0, "1 stop": 1, "2 stops": 2, "3 stops": 3, "4 stops": 4}


def to_iata(value) -> str | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    text = str(value).strip()
    if len(text) == 3 and text.isalpha():
        return text.upper()
    return CITY_TO_IATA.get(text.lower())


def parse_duration_minutes(value) -> float:
    """'2h 50m' -> 170. Durations under 30 min are data errors -> NaN."""
    if not isinstance(value, str):
        return np.nan
    hours = re.search(r"(\d+)\s*h", value)
    minutes = re.search(r"(\d+)\s*m", value)
    if not hours and not minutes:
        return np.nan
    total = (int(hours.group(1)) if hours else 0) * 60 + (int(minutes.group(1)) if minutes else 0)
    return float(total) if total >= 30 else np.nan


def parse_clock_hour(value) -> float:
    """'22:20' or '01:10 22 Mar' -> fractional hour of day."""
    if not isinstance(value, str):
        return np.nan
    match = re.match(r"\s*(\d{1,2}):(\d{2})", value)
    if not match:
        return np.nan
    return int(match.group(1)) + int(match.group(2)) / 60


def normalize_airline(value) -> str | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    text = str(value).strip()
    return None if not text or text.lower() == "unknown" else text


def normalize_info(value) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    return None if text in ("", "no info") else text


def date_features(dates: pd.Series) -> pd.DataFrame:
    dates = pd.to_datetime(dates)
    return pd.DataFrame({
        "month": dates.dt.month.astype(float),
        "day_of_month": dates.dt.day.astype(float),
        "day_of_week": dates.dt.dayofweek.astype(float),
        "day_of_year": dates.dt.dayofyear.astype(float),
    }, index=dates.index)


def via_from_route(route) -> str | None:
    """'DEL → LKO → BOM → COK' -> 'LKO-BOM'; non-stop -> 'none'."""
    if not isinstance(route, str) or "→" not in route:
        return None
    stops = [part.strip() for part in route.split("→")][1:-1]
    return "-".join(stops) if stops else "none"


def via_from_connections(connections) -> str | None:
    """['lko', 'BOM'] -> 'LKO-BOM'; [] -> 'none'; None -> unknown."""
    if connections is None:
        return None
    codes = [to_iata(c) for c in connections]
    if any(c is None for c in codes):
        raise ValueError(f"connections must be IATA codes or known city names; got {connections!r}")
    return "-".join(codes) if codes else "none"


def add_arrival_features(frame: pd.DataFrame) -> pd.DataFrame:
    """
    Arrival hour and overnight flag, derived from departure + duration.

    This is the FIRST step of every saved model pipeline, so these columns
    are always recomputed there; any arr_hour/overnight values a caller puts
    in the frame are overwritten. Matches the raw Arrival_Time column on
    10,679 of 10,682 Kaggle rows (all its airports share one time zone); the
    other 3 are raw-data errors whose listed arrival contradicts their own
    departure + duration.
    """
    frame = frame.copy()
    end = frame["dep_hour"] + frame["duration_min"] / 60
    frame["arr_hour"] = end % 24
    frame["overnight"] = (end >= 24).astype(float).where(end.notna())
    return frame


def build_training_frame(df: pd.DataFrame) -> pd.DataFrame:
    """
    Raw CSV -> feature frame (FEATURES + TARGET + journey_date).

    Accepts the Kaggle schema shipped in data/flight_fares.csv, or the
    minimal normalized schema from data/README.md (origin, destination,
    airline, month, day_of_week, price; trip-detail columns optional).
    """
    if "Date_of_Journey" in df.columns:
        journey = pd.to_datetime(df["Date_of_Journey"], format="%d/%m/%Y")
        frame = pd.DataFrame({
            "origin": df["origin"].map(to_iata),
            "destination": df["destination"].map(to_iata),
            "airline": df["airline"].map(normalize_airline),
            "additional_info": df.get("Additional_Info", pd.Series(index=df.index, dtype=object)).map(normalize_info),
            "total_stops": df.get("Total_Stops", pd.Series(index=df.index, dtype=object)).map(_STOPS).astype(float),
            "duration_min": df.get("Duration", pd.Series(index=df.index, dtype=object)).map(parse_duration_minutes),
            "dep_hour": df.get("Dep_Time", pd.Series(index=df.index, dtype=object)).map(parse_clock_hour),
            "via": df.get("Route", pd.Series(index=df.index, dtype=object)).map(via_from_route),
        }, index=df.index)
        frame = frame.join(date_features(journey))
        frame["journey_date"] = journey
    else:
        required = {"origin", "destination", "airline", "month", "day_of_week", TARGET}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(
                "flight_fares.csv must use the Kaggle schema or the normalized schema "
                f"from data/README.md; missing columns: {sorted(missing)}"
            )
        frame = pd.DataFrame({
            "origin": df["origin"].map(to_iata),
            "destination": df["destination"].map(to_iata),
            "airline": df["airline"].map(normalize_airline),
            "additional_info": df["additional_info"].map(normalize_info) if "additional_info" in df else None,
            "total_stops": df["total_stops"].astype(float) if "total_stops" in df else np.nan,
            "duration_min": df["duration_min"].astype(float) if "duration_min" in df else np.nan,
            "dep_hour": df["dep_hour"].astype(float) if "dep_hour" in df else np.nan,
            "via": df["via"] if "via" in df else None,
            "month": df["month"].astype(float),
            "day_of_month": df["day_of_month"].astype(float) if "day_of_month" in df else np.nan,
            "day_of_week": df["day_of_week"].astype(float),
            "day_of_year": np.nan,
        }, index=df.index)
        frame["journey_date"] = pd.NaT

    # Placeholders; the model pipeline derives them (see add_arrival_features).
    frame["arr_hour"] = np.nan
    frame["overnight"] = np.nan
    frame[TARGET] = pd.to_numeric(df[TARGET], errors="coerce")
    unmapped = frame["origin"].isna() | frame["destination"].isna()
    if unmapped.any():
        print(f"Dropping {int(unmapped.sum())} rows with unmapped origin/destination.")
    frame = frame[~unmapped & frame[TARGET].gt(0)]
    return _clean_categoricals(frame)


def build_inference_frame(origin_iata: str, destination_iata: str, travel_date,
                          airline: str | None = None, total_stops: int | None = None,
                          duration_min: float | None = None, dep_hour: float | None = None,
                          connections: list[str] | None = None,
                          additional_info: str | None = None) -> pd.DataFrame:
    """One-row feature frame in exactly the training column order."""
    row = {
        "origin": to_iata(origin_iata),
        "destination": to_iata(destination_iata),
        "airline": normalize_airline(airline),
        "additional_info": normalize_info(additional_info),
        "total_stops": np.nan if total_stops is None else float(total_stops),
        "duration_min": np.nan if duration_min is None else float(duration_min),
        "dep_hour": np.nan if dep_hour is None else float(dep_hour),
        "via": via_from_connections(connections),
        "arr_hour": np.nan,   # derived inside the model pipeline
        "overnight": np.nan,
    }
    frame = pd.DataFrame([row])
    frame = frame.join(date_features(pd.Series([pd.Timestamp(travel_date)])))
    return _clean_categoricals(frame[FEATURES].copy())


def mask_columns(X: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    """Blank out columns a tier doesn't use (NaN, which every encoder treats as missing)."""
    X = X.copy()
    for col in columns:
        X[col] = np.nan
    return _clean_categoricals(X)


def _clean_categoricals(frame: pd.DataFrame) -> pd.DataFrame:
    """Use np.nan (not None) for missing categoricals; sklearn imputers only detect NaN."""
    for col in CATEGORICAL:
        if col in frame:
            frame[col] = frame[col].astype(object).where(frame[col].notna(), np.nan)
    return frame

