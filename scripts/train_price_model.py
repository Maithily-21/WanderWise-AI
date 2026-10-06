"""
Trains an XGBoost regressor on data/flight_fares.csv and serializes it
to analytics/models/price_model.pkl.

The trainer accepts the normalized schema documented in data/README.md and
the legacy Kaggle flight-price schema currently included in this repository.

Run from the repo root:
    python scripts/train_price_model.py
"""
import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
import xgboost as xgb

CATEGORICAL = ["origin", "destination", "airline"]
NUMERIC = ["days_before_departure", "month", "day_of_week"]
TARGET = "price"


def _prepare_training_data(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """Normalize supported fare datasets to the model's feature schema."""
    required = set(CATEGORICAL + NUMERIC + [TARGET])
    if required.issubset(df.columns):
        features = df[CATEGORICAL + NUMERIC].copy()
        return features, df[TARGET]

    legacy_required = {"airline", "Date_of_Journey", "origin", "destination", TARGET}
    missing = legacy_required - set(df.columns)
    if missing:
        raise ValueError(
            "flight_fares.csv must use the normalized schema from data/README.md "
            f"or the legacy Kaggle schema; missing columns: {sorted(missing)}"
        )

    travel_dates = pd.to_datetime(df["Date_of_Journey"], format="mixed", dayfirst=True)
    features = pd.DataFrame({
        "origin": df["origin"],
        "destination": df["destination"],
        "airline": df["airline"],
        "days_before_departure": 30,
        "month": travel_dates.dt.month,
        "day_of_week": travel_dates.dt.dayofweek,
    })
    print("Using legacy Kaggle fare schema; days_before_departure set to 30.")
    return features, df[TARGET]


def main():
    df = pd.read_csv("data/flight_fares.csv")
    X, y = _prepare_training_data(df)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    preprocessor = ColumnTransformer([
        ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
    ], remainder="passthrough")

    model = Pipeline([
        ("preprocess", preprocessor),
        ("regressor", xgb.XGBRegressor(
            n_estimators=200, max_depth=5, learning_rate=0.08,
            subsample=0.9, colsample_bytree=0.9, random_state=42,
        )),
    ])

    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    print(f"Test MAE: {mean_absolute_error(y_test, preds):.2f}")
    print(f"Test R^2: {r2_score(y_test, preds):.3f}")

    joblib.dump(model, "analytics/models/price_model.pkl")
    print("Saved analytics/models/price_model.pkl")


if __name__ == "__main__":
    main()
