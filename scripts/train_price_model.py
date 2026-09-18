"""
Trains an XGBoost regressor on data/flight_fares.csv and serializes it
to analytics/models/price_model.pkl.

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


def main():
    df = pd.read_csv("data/flight_fares.csv")
    X = df[CATEGORICAL + NUMERIC]
    y = df[TARGET]

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
