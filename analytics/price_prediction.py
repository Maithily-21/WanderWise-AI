"""
ANALYTICS LAYER — Flight Price Prediction

IMPORTANT CONTEXT SPECIFIC TO THIS REPO: tools/flight_tool.py uses
AviationStack, which provides live/status flight data — NOT ticket
prices (this is called out directly in flight_tool.py's own output
text). So this module can't work off a "current price" the way a
pricing-API-backed system could. Instead it predicts an *expected
fare* for a route from historical patterns, independent of whatever
flight_tool.py returned.

Loads a trained XGBoost pipeline from analytics/models/price_model.pkl
(trained by scripts/train_price_model.py on data/flight_fares.csv,
which YOU provide — see data/README.md).

Falls back to a clearly-labeled stub if no trained model exists yet,
so the app keeps working end-to-end without it.
"""
from pathlib import Path
from datetime import date, timedelta

import joblib
import pandas as pd

MODEL_PATH = Path(__file__).parent / "models" / "price_model.pkl"


class FlightPricePredictor:
    def __init__(self):
        self.model = None
        self.model_version = "stub-v0"
        if MODEL_PATH.exists():
            try:
                self.model = joblib.load(MODEL_PATH)
                self.model_version = "xgboost-v1"
            except Exception as e:
                print(f"[price_prediction] Failed to load trained model, using stub: {e}")

    def predict(self, origin_iata: str | None, destination_iata: str | None,
                airline: str = "unknown", days_ahead: int = 30) -> dict:
        """
        `days_ahead` defaults to 30 since this repo's natural-language
        query doesn't carry a structured travel date — adjust the
        caller if/when you add explicit date parsing.
        """
        if not origin_iata or not destination_iata:
            return {
                "estimated_price_usd": None,
                "note": "Could not resolve origin/destination airports from the query.",
                "model_version": self.model_version,
            }

        if self.model is not None:
            return self._predict_with_model(origin_iata, destination_iata, airline, days_ahead)
        return self._predict_stub(origin_iata, destination_iata)

    def _predict_with_model(self, origin, destination, airline, days_ahead) -> dict:
        travel_date = date.today() + timedelta(days=days_ahead)
        features = pd.DataFrame([{
            "origin": origin, "destination": destination, "airline": airline,
            "days_before_departure": days_ahead, "month": travel_date.month,
            "day_of_week": travel_date.weekday(),
        }])
        predicted = float(self.model.predict(features)[0])
        return {
            "estimated_price_usd": round(predicted, 2),
            "assumed_days_ahead": days_ahead,
            "note": "Estimate from historical fare patterns — AviationStack (used for live flight status) doesn't provide ticket prices.",
            "model_version": self.model_version,
        }

    def _predict_stub(self, origin, destination) -> dict:
        return {
            "estimated_price_usd": None,
            "note": f"No trained price model yet for {origin}->{destination}. "
                    f"Add data/flight_fares.csv and run scripts/train_price_model.py.",
            "model_version": self.model_version,
        }


price_predictor = FlightPricePredictor()
