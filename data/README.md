# Put your datasets here

This folder is empty on purpose. Drop your own CSV files in here,
named exactly as below, then run the matching training script from
the repo root. Nothing else in the codebase needs to change.

## `flight_fares.csv`
The repo ships the Kaggle Indian domestic flight-fare dataset here
(columns `airline, Date_of_Journey, origin, destination, Route, Dep_Time,
Arrival_Time, Duration, Total_Stops, Additional_Info, price`). Prices are
**INR**, journeys are Mar–Jun 2019, and cities are names that the trainer
maps to IATA codes (`Banglore`→`BLR`, `Delhi`/`New Delhi`→`DEL`, …). It
covers 5 routes: BLR→DEL, BOM→HYD, CCU→BLR, DEL→COK, MAA→CCU.

Alternatively, a minimal normalized schema is accepted:

| column | type | notes |
|---|---|---|
| `origin` | string | IATA code, e.g. `DAC` |
| `destination` | string | IATA code, e.g. `NRT` |
| `airline` | string | airline name |
| `month` | int | 1–12, travel month |
| `day_of_week` | int | 0–6, travel day of week (0 = Monday) |
| `price` | float | the fare — training target |

Optional: `day_of_month`, `total_stops`, `duration_min`, `dep_hour`,
`additional_info`. (`days_before_departure` is ignored: the Kaggle data has
no booking date, so the old constant value carried no information.)

Train with:
```bash
python scripts/train_price_model.py
```
See `analytics/models/README.md` for the evaluation protocol and results.

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

The script also supports the TripAdvisor export
`tripadvisor_hotel_reviews_dataset_sample.csv`. It derives labels from the
numeric `rating` column: ratings 1–2 are `negative`, 3 is `neutral`, and
4–5 are `positive`.

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
