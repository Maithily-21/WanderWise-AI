# Put your datasets here

This folder is empty on purpose. Drop your own CSV files in here,
named exactly as below, then run the matching training script from
the repo root. Nothing else in the codebase needs to change.

## `flight_fares.csv`
Required columns:

| column | type | notes |
|---|---|---|
| `origin` | string | IATA code, e.g. `DAC` |
| `destination` | string | IATA code, e.g. `NRT` |
| `days_before_departure` | int | how far ahead of travel the fare was recorded |
| `airline` | string | airline/carrier code |
| `month` | int | 1–12, travel month |
| `day_of_week` | int | 0–6, travel day of week (0 = Monday) |
| `price` | float | the fare — training target |

Train with:
```bash
python scripts/train_price_model.py
```

## `travel_reviews.csv`
Required columns:

| column | type | notes |
|---|---|---|
| `review_text` | string | the free-text review |
| `sentiment_label` | string | one of `positive`, `neutral`, `negative` |

Train with:
```bash
python scripts/train_sentiment_model.py
```

## If you don't have data yet

Both `analytics/price_prediction.py` and `analytics/sentiment_analysis.py`
check for their `.pkl` file at startup. If missing, they fall back to
a clearly labeled placeholder (`model_version: "stub-v0"`) instead of
erroring, so the app keeps working end-to-end while you collect data.

Note on price prediction specifically: this repo's flight agent uses
AviationStack, which returns live/status flight data, not ticket
prices — so even with a trained model, "price prediction" here means
an estimated fare from historical patterns, not a comparison against
a real live price the flight agent found.
