# Trained models land here

`scripts/train_price_model.py` writes `price_model.pkl` here, and
`scripts/train_sentiment_model.py` writes `sentiment_model.pkl` here.
The `.pkl` files are git-ignored — trained binaries shouldn't live in
version control. This README keeps the folder present before you run training.

## Flight price model

| | |
|---|---|
| Dataset | `data/flight_fares.csv` (Kaggle Indian domestic fares, INR, journeys Mar–Jun 2019) |
| Train + evaluate | `python scripts/train_price_model.py` (~15 min; `--quick` for a smoke run) |
| Artifacts | `price_model.pkl` (bundle), `price_model_metrics.json` (full evaluation report) |
| Inference | `analytics/price_prediction.py` → `price_predictor.predict(origin_iata, destination_iata, airline="unknown", days_ahead=30, *, total_stops=None, duration_min=None, dep_hour=None, connections=None)` |
| Shared preprocessing | `analytics/price_features.py` (used by both training and inference) |
| Tests | `python -m unittest discover -s tests -v` |

### What's in the bundle

One XGBoost model (log-price target) per **input tier**, because the app
rarely knows every detail of a flight:

| tier | inputs used | when inference uses it |
|---|---|---|
| `full` | everything in `trip_details` + connecting airports | trip details given and `connections` known (implied `[]` when `total_stops=0`) |
| `trip_details` | route, travel date, airline, stops, duration, departure hour, derived arrival hour / overnight flag, fare notes | airline + `total_stops` + `duration_min` + `dep_hour` all given |
| `route_date_airline` | route, travel date, airline | airline given |
| `route_date` | route, travel date | fallback when no usable flight details (no API key, API error, unknown airline) |

The bundle also stores the covered routes, airlines, journey months, and
80% prediction-interval widths (split-conformal on out-of-fold log
residuals). Inference returns no number for routes outside the training
data and warns when the travel month is outside Mar–Jun.

Arrival hour and the overnight flag are **derived inside every saved
pipeline** (first step, `derive_arrival` → `price_features.add_arrival_features`)
from `dep_hour + duration_min`; any values a caller supplies for them are
overwritten. The derivation matches the raw `Arrival_Time` column on 10,679
of 10,682 rows; the other 3 are raw-data errors (listed arrival contradicts
the row's own departure + duration).

### How the app supplies flight details

`backend.flight_agent` calls `tools.flight_tool.search_flights_with_details()`:
one AviationStack request returning the unchanged `flight_results` text (the
frontend parses it) plus structured per-flight details: airline, departure
hour, duration and `total_stops = 0` with no connections, since each
AviationStack record is a single direct leg. `backend.analytics_node` passes
them to `price_predictor.predict_for_trip()`, which scores every flight on the
route with the most detailed tier its fields allow (usually `full`) and
reports the median as the headline fare, with per-flight estimates in
`flight_estimates`. Duration is only computed when both airports share a time
zone (AviationStack times are local wall-clock); codeshare duplicates are
skipped; airline names are matched case-insensitively plus a small alias list
(`AIRLINE_ALIASES`), and unknown airlines fall back to `route_date` with a warning.

### Evaluation protocol

- 220 exact duplicate rows dropped; rows with identical inputs are grouped
  so they never straddle train/test or CV folds.
- 80/20 grouped train/test split (seed 42). Model selection and
  hyperparameter search (RandomizedSearchCV, 25 iterations, GroupKFold(5))
  use the training split only; the test split is scored once at the end.
- The original model is retrained on the same split and scored on the same
  test rows for the comparison below.
- The shipped bundle is refit on all rows with the selected hyperparameters.

### Results (held-out test split, 2,093 rows, INR) — model `xgboost-v3`

| model | inputs | MAE | RMSE | R² | MAPE |
|---|---|---|---|---|---|
| Original baseline | route (city names), airline, month, weekday | 1,813 | 2,698 | 0.637 | 21.2% |
| Original baseline, airline unknown | route, month, weekday | 3,107 | 4,185 | 0.127 | 32.7% |
| Original baseline **as the app called it** (IATA codes, airline unknown) | — | 3,748 | 4,996 | −0.245 | 40.6% |
| **`full`** | trip details + connecting airports | **561** | **1,185** | **0.930** | 6.0% |
| **`trip_details`** | airline, stops, duration, times | **588** | **1,357** | **0.908** | 6.2% |
| **`route_date_airline`** | same information as the baseline | **1,608** | **2,381** | **0.717** | 17.5% |
| **`route_date`** (what the app sends) | route + date | **2,262** | **3,119** | **0.515** | 26.3% |

80% interval coverage on test: 81.2% / 82.6% / 77.6% / 79.6% (tiers in table order).

Temporal check (train on Mar–May, test on June): baseline MAE 1,703 (R² 0.643)
vs `full` 1,050 (R² 0.851), `trip_details` 1,063, `route_date_airline` 1,755,
`route_date` 2,431 (R² 0.348).

v2 → v3 changes (each kept only because grouped CV on the train split improved):
connecting-airport feature (`via`), arrival hour + overnight flag derived from
departure + duration, and day-of-year. Rejected after testing: averaging
XGBoost with random forest (no gain), and an absolute-error objective for
`route_date` (better in-period CV, worse on the temporal check, which matters
more because the app always predicts future dates).

Candidate comparison (5-fold grouped CV on train, default hyperparameters,
log target): XGBoost ≈ random forest > HistGradientBoosting ≫ Ridge on every
tier; XGBoost was kept as the fastest of the top two and an existing
dependency. Full numbers are in `price_model_metrics.json`.
