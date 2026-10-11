"""
Trains the flight fare model on data/flight_fares.csv, evaluates it against
the original baseline on the same held-out test split, and saves:

    analytics/models/price_model.pkl            (model bundle, git-ignored)
    analytics/models/price_model_metrics.json   (evaluation report)

Run from the repo root:
    python scripts/train_price_model.py              # full run (~15 min)
    python scripts/train_price_model.py --quick      # fewer tuning iterations

Protocol (all seeded with SEED):
1. Drop exact duplicate rows. Rows with identical inputs but different
   prices are kept but grouped, so a group never straddles train/test or
   CV folds (GroupShuffleSplit / GroupKFold).
2. 80/20 train/test split. The test split is used ONCE, after model
   selection and tuning, which happen with 5-fold grouped CV on train only.
3. One model per input tier (see analytics/price_features.TIERS), because
   the app usually only knows route + date. Log-price target; per-tier
   objective in TIER_OBJECTIVE.
4. Prediction intervals: split-conformal on out-of-fold log residuals from
   the training split; empirical coverage is then checked on test.
5. Final bundle is refit on train+test with the selected hyperparameters.
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
import xgboost as xgb
from sklearn.base import clone
from sklearn.compose import ColumnTransformer, TransformedTargetRegressor
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import (mean_absolute_error, mean_absolute_percentage_error,
                             mean_squared_error, r2_score)
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, RandomizedSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import (FunctionTransformer, OneHotEncoder, OrdinalEncoder,
                                   StandardScaler)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analytics.price_features import (CATEGORICAL, FEATURES, NUMERIC, TARGET, TIERS,  # noqa: E402
                                      add_arrival_features, build_training_frame, mask_columns)

DATA_PATH = ROOT / "data" / "flight_fares.csv"
MODEL_PATH = ROOT / "analytics" / "models" / "price_model.pkl"
METRICS_PATH = ROOT / "analytics" / "models" / "price_model_metrics.json"
SEED = 42
INTERVAL_LEVEL = 0.80
MODEL_VERSION = "xgboost-v3"
# Per-tier XGBoost objective override (on the log target); default is squared
# error. Tried reg:absoluteerror for route_date: CV MAE 2,250 -> 2,180, but on
# the Mar-May -> June temporal check MAE rose 2,431 -> 2,562. The app always
# predicts future dates, so squared error is kept for every tier.
TIER_OBJECTIVE: dict[str, str] = {}


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def metrics(y_true, y_pred) -> dict:
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 1),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 1),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
        # Safe here: the minimum fare in the data is > 1,700 INR.
        "mape_pct": round(float(mean_absolute_percentage_error(y_true, y_pred)) * 100, 2),
    }


# ---------------------------------------------------------------------------
# Original baseline (verbatim copy of the previous training recipe)
# ---------------------------------------------------------------------------

BASELINE_CAT = ["origin", "destination", "airline"]


def baseline_features(raw: pd.DataFrame, airline_override=None, location_map=None) -> pd.DataFrame:
    dates = pd.to_datetime(raw["Date_of_Journey"], format="mixed", dayfirst=True)
    origin, destination = raw["origin"], raw["destination"]
    if location_map is not None:
        origin, destination = origin.map(location_map), destination.map(location_map)
    return pd.DataFrame({
        "origin": origin, "destination": destination,
        "airline": raw["airline"] if airline_override is None else airline_override,
        "days_before_departure": 30,
        "month": dates.dt.month, "day_of_week": dates.dt.dayofweek,
    })


def baseline_model() -> Pipeline:
    return Pipeline([
        ("preprocess", ColumnTransformer([
            ("cat", OneHotEncoder(handle_unknown="ignore"), BASELINE_CAT),
        ], remainder="passthrough")),
        ("regressor", xgb.XGBRegressor(
            n_estimators=200, max_depth=5, learning_rate=0.08,
            subsample=0.9, colsample_bytree=0.9, random_state=42,
        )),
    ])


# ---------------------------------------------------------------------------
# Candidate models
# ---------------------------------------------------------------------------

def _derive_step() -> tuple[str, FunctionTransformer]:
    # First pipeline step: arr_hour/overnight are always computed from
    # dep_hour + duration_min here, never taken from the caller.
    return ("derive_arrival", FunctionTransformer(add_arrival_features))


def _mask_step(tier: str) -> FunctionTransformer:
    # Part of the saved pipeline, so inference can't forget to blank the
    # columns this tier was trained without.
    return FunctionTransformer(mask_columns, kw_args={"columns": TIERS[tier]})


def _onehot_preprocessor(numeric_step) -> ColumnTransformer:
    return ColumnTransformer([
        ("cat", Pipeline([
            ("impute", SimpleImputer(strategy="constant", fill_value="__missing__")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]), CATEGORICAL),
        ("num", numeric_step, NUMERIC),
    ])


def _log_target(model):
    return TransformedTargetRegressor(regressor=model, func=np.log, inverse_func=np.exp)


def candidate_models(tier: str) -> dict:
    mask = ("mask", _mask_step(tier))
    derive = _derive_step()
    ordinal = ColumnTransformer([
        ("cat", OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=np.nan,
                               encoded_missing_value=np.nan), CATEGORICAL),
        ("num", "passthrough", NUMERIC),
    ])
    return {
        "ridge_log": _log_target(Pipeline([derive, mask, ("preprocess", _onehot_preprocessor(Pipeline([
            ("impute", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)),
            ("scale", StandardScaler())]))), ("regressor", Ridge(alpha=1.0))])),
        "random_forest_log": _log_target(Pipeline([derive, mask, ("preprocess", _onehot_preprocessor(
            SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True))),
            ("regressor", RandomForestRegressor(n_estimators=300, min_samples_leaf=2,
                                                n_jobs=-1, random_state=SEED))])),
        "hist_gb_log": _log_target(Pipeline([derive, mask, ("preprocess", ordinal),
            ("regressor", HistGradientBoostingRegressor(
                categorical_features=list(range(len(CATEGORICAL))), random_state=SEED))])),
        "xgboost_log": xgboost_model(tier),
    }


def xgboost_model(tier: str, **params) -> TransformedTargetRegressor:
    defaults = dict(n_estimators=400, max_depth=6, learning_rate=0.08, subsample=0.9,
                    colsample_bytree=0.9, random_state=SEED, n_jobs=-1,
                    objective=TIER_OBJECTIVE.get(tier, "reg:squarederror"))
    defaults.update(params)
    return _log_target(Pipeline([
        _derive_step(),
        ("mask", _mask_step(tier)),
        ("preprocess", _onehot_preprocessor("passthrough")),  # XGBoost handles NaN natively
        ("regressor", xgb.XGBRegressor(**defaults)),
    ]))


XGB_SEARCH_SPACE = {
    "regressor__regressor__n_estimators": [200, 400, 600, 900],
    "regressor__regressor__max_depth": [3, 4, 5, 6, 8, 10],
    "regressor__regressor__learning_rate": [0.02, 0.04, 0.06, 0.1, 0.15],
    "regressor__regressor__subsample": [0.6, 0.75, 0.9, 1.0],
    "regressor__regressor__colsample_bytree": [0.5, 0.7, 0.9, 1.0],
    "regressor__regressor__min_child_weight": [1, 2, 4, 8],
    "regressor__regressor__reg_lambda": [0.1, 1.0, 5.0, 20.0],
}


def oof_predictions(model, X, y, groups, cv) -> np.ndarray:
    preds = np.empty(len(y))
    for train_idx, val_idx in cv.split(X, y, groups):
        preds[val_idx] = clone(model).fit(X.iloc[train_idx], y[train_idx]).predict(X.iloc[val_idx])
    return preds


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true",
                        help="Fewer tuning iterations and skip slow candidates (for smoke tests).")
    args = parser.parse_args()
    n_iter = 6 if args.quick else 25

    raw_all = pd.read_csv(DATA_PATH)
    raw = raw_all.drop_duplicates().reset_index(drop=True)
    print(f"Loaded {len(raw_all)} rows; dropped {len(raw_all) - len(raw)} exact duplicates.")

    frame = build_training_frame(raw)
    raw = raw.loc[frame.index]
    X, y = frame[FEATURES], frame[TARGET].to_numpy(dtype=float)
    # Rows with identical inputs share a group so they never straddle a split.
    input_cols = [c for c in raw.columns if c != TARGET]
    groups = pd.util.hash_pandas_object(raw[input_cols], index=False).to_numpy()

    train_idx, test_idx = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
                               .split(X, y, groups))
    X_train, X_test, y_train, y_test = X.iloc[train_idx], X.iloc[test_idx], y[train_idx], y[test_idx]
    g_train = groups[train_idx]
    cv = GroupKFold(n_splits=5)
    print(f"Train {len(train_idx)} rows, test {len(test_idx)} rows (grouped split, seed {SEED}).")

    report = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": {
            "path": "data/flight_fares.csv", "rows_raw": len(raw_all), "rows_after_dedup": len(raw),
            "currency": "INR", "journey_dates": [str(frame.journey_date.min().date()),
                                                 str(frame.journey_date.max().date())],
            "routes": sorted(f"{o}-{d}" for o, d in set(zip(frame.origin, frame.destination))),
        },
        "split": {"method": "GroupShuffleSplit 80/20 on identical-input groups", "seed": SEED,
                  "train_rows": len(train_idx), "test_rows": len(test_idx)},
    }

    # --- Baseline -----------------------------------------------------------
    raw_train, raw_test = raw.iloc[train_idx], raw.iloc[test_idx]
    base = baseline_model().fit(baseline_features(raw_train), y_train)
    city_to_iata = {c: i for c, i in zip(raw.origin, frame.origin)} | \
                   {c: i for c, i in zip(raw.destination, frame.destination)}
    report["baseline"] = {
        "description": "Previous recipe: XGBoost on raw target, one-hot city names + airline, "
                       "constant days_before_departure=30, month, day_of_week",
        "test": {
            "full": metrics(y_test, base.predict(baseline_features(raw_test))),
            "route_date": metrics(y_test, base.predict(baseline_features(raw_test, "unknown"))),
            # What the app actually sent it: IATA codes + airline="unknown".
            "as_called_by_app": metrics(y_test, base.predict(
                baseline_features(raw_test, "unknown", city_to_iata))),
        },
    }
    print("Baseline test:", json.dumps(report["baseline"]["test"]))

    # --- Candidate comparison (grouped CV on train only) ---------------------
    comparison = []
    for tier in TIERS:
        for name, model in candidate_models(tier).items():
            if args.quick and name == "random_forest_log":
                continue
            start = time.perf_counter()
            preds = oof_predictions(model, X_train, y_train, g_train, cv)
            comparison.append({"tier": tier, "model": name, **metrics(y_train, preds),
                               "cv_seconds": round(time.perf_counter() - start, 1)})
            print("CV", comparison[-1])
    report["cv_comparison"] = comparison

    # --- Tune XGBoost per tier (grouped CV on train only) --------------------
    final_models, tuned, interval_q, oof_by_tier = {}, {}, {}, {}
    for tier in TIERS:
        search = RandomizedSearchCV(
            xgboost_model(tier), XGB_SEARCH_SPACE, n_iter=n_iter, cv=cv,
            scoring="neg_mean_absolute_error", random_state=SEED, n_jobs=1,
        )
        search.fit(X_train, y_train, groups=g_train)
        params = {k.split("__")[-1]: v for k, v in search.best_params_.items()}
        tuned[tier] = {"params": params, "cv_mae": round(-search.best_score_, 1)}
        print(f"Tuned {tier}: CV MAE {-search.best_score_:.1f} with {params}")

        # Split-conformal half-width on log scale from out-of-fold residuals.
        oof = oof_predictions(xgboost_model(tier, **params), X_train, y_train, g_train, cv)
        oof_by_tier[tier] = oof
        interval_q[tier] = float(np.quantile(np.abs(np.log(y_train) - np.log(oof)), INTERVAL_LEVEL))
        final_models[tier] = xgboost_model(tier, **params).fit(X_train, y_train)
    report["tuning"] = {"search": "RandomizedSearchCV", "n_iter": n_iter, "cv": "GroupKFold(5)",
                        "scoring": "neg_mean_absolute_error", "tiers": tuned}

    # --- Single evaluation on the untouched test split -----------------------
    test_report = {}
    for tier, model in final_models.items():
        start = time.perf_counter()
        pred = model.predict(X_test)
        ms_per_row = (time.perf_counter() - start) * 1000 / len(X_test)
        lo, hi = pred * np.exp(-interval_q[tier]), pred * np.exp(interval_q[tier])
        test_report[tier] = {**metrics(y_test, pred),
                             "interval_coverage": round(float(np.mean((y_test >= lo) & (y_test <= hi))), 3),
                             "predict_ms_per_row_batch": round(ms_per_row, 4)}
    report["final_test"] = test_report
    report["intervals"] = {"level": INTERVAL_LEVEL, "method": "split-conformal on |log residual| "
                           "(out-of-fold, train split)", "log_half_width": interval_q}
    print("Final test:", json.dumps(test_report, indent=1))

    # --- Temporal robustness check: train Mar-May, test June -----------------
    cutoff = pd.Timestamp("2019-06-01")
    early, late = (frame.journey_date < cutoff).to_numpy(), (frame.journey_date >= cutoff).to_numpy()
    temporal = {"train": "journeys before 2019-06-01", "test": "June 2019 journeys",
                "baseline_full": metrics(y[late], baseline_model().fit(
                    baseline_features(raw[early]), y[early]).predict(baseline_features(raw[late])))}
    for tier in TIERS:
        model = xgboost_model(tier, **tuned[tier]["params"]).fit(X[early], y[early])
        temporal[f"final_{tier}"] = metrics(y[late], model.predict(X[late]))
    report["temporal_check"] = temporal
    print("Temporal check:", json.dumps(temporal, indent=1))

    # --- Refit on all rows and save ------------------------------------------
    bundle = {
        "model_version": MODEL_VERSION,
        "models": {tier: xgboost_model(tier, **tuned[tier]["params"]).fit(X, y) for tier in TIERS},
        "features": FEATURES,
        "tiers": TIERS,
        "tier_objective": {t: TIER_OBJECTIVE.get(t, "reg:squarederror") for t in TIERS},
        "currency": "INR",
        "interval_level": INTERVAL_LEVEL,
        "interval_log_half_width": interval_q,
        "routes": sorted(set(zip(frame.origin, frame.destination))),
        "airlines": sorted(frame.airline.dropna().unique()),
        "journey_months": sorted(int(m) for m in frame.month.unique()),
        "journey_date_range": report["dataset"]["journey_dates"],
        "test_metrics": test_report,
        "sklearn_version": sklearn.__version__,
        "xgboost_version": xgb.__version__,
    }
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, MODEL_PATH)
    METRICS_PATH.write_text(json.dumps(report, indent=2))
    print(f"Saved {MODEL_PATH.relative_to(ROOT)} and {METRICS_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
