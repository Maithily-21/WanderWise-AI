# Changes vs. the original TripMate AI

Base: https://github.com/entbappy/TripMate-AI-A-Multi-Agent-Travel-Planner-with-LangGraph

## New files

| File | Purpose |
|---|---|
| `tools/weather_tool.py` | OpenWeatherMap client — Weather Agent |
| `tools/local_info_tool.py` | OpenTripMap client — Local Info Agent |
| `tools/location_resolver.py` | Shared destination resolution (also fixes a real parsing gap — see below) |
| `analytics/price_prediction.py` | Trainable XGBoost fare estimator, stub fallback |
| `analytics/sentiment_analysis.py` | Trainable TF-IDF+LogisticRegression sentiment scorer, applied to live Tavily hotel snippets |
| `analytics/recommendation_engine.py` | Ranks OpenTripMap attractions by rating |
| `scripts/train_price_model.py` | Trains the price model from `data/flight_fares.csv` |
| `scripts/train_sentiment_model.py` | Trains the sentiment model from `data/travel_reviews.csv` |
| `data/README.md` | Empty dataset drop-in folder + column spec |
| `db/database.py` | SQLAlchemy engine, separate from the LangGraph checkpointer |
| `db/models.py` | `TravelPlanRecord` — structured, queryable plan storage |
| `.env.example` | Documents all original + new env vars |
| `CHANGES.md` | This file |

## Modified files

| File | What changed |
|---|---|
| `backend.py` | Graph restructured from sequential (`flight→hotel→itinerary→final`) to parallel fan-out (`flight/hotel/weather/local_info` simultaneously → `itinerary` fan-in → new `analytics_node` → `final`). `TravelState` extended with `weather_results`, `local_info_results`, `price_prediction`, `sentiment_summary`, `recommended_attractions`. `llm_calls` changed to `Annotated[int, operator.add]` — required once multiple nodes write it in the same parallel superstep. `itinerary_agent` and `final_agent` prompts extended to use the new data. Added `_persist_plan_record()` writing to the new structured table after each run. |
| `app.py` | `/api/travel` response extended with the new fields. Added `/api/analytics/dashboard-summary`. |
| `requirements.txt` | Added `sqlalchemy`, `pandas`, `numpy`, `scikit-learn`, `xgboost`, `joblib`. |
| `templates/index.html` | Added a "Trip Insights" section. |
| `static/script.js` | Added `showInsights()`, wired into the existing result-handling flow. |
| `static/style.css` | Added `.insights-grid` / `.insight-card` rules matching the existing dark theme. |
| `.gitignore` | Added `analytics/models/*.pkl`. |

## A bug found and fixed along the way

`tools/flight_tool.py`'s `parse_route()` — **left untouched**, since
`flight_agent` still relies on its exact original behavior — has a
gap: for a query like *"Japan trip from Bangladesh"* (the app's own
suggested example, destination named without an explicit "to"), the
`from X` regex pattern matches and returns immediately with no
destination, never reaching the function's own mention-scanning
fallback further down. `tools/location_resolver.py` (used by the new
Weather Agent, Local Info Agent, and analytics node) works around
this independently, verified against all of the app's own example
prompts. `flight_agent` itself is unchanged and still has this gap.

## What's intentionally *not* changed

- `tools/flight_tool.py` and `tools/tavily_tool.py` — untouched
- The LangGraph checkpointer setup — untouched, still the source of
  truth for conversation/thread state
- The core LLM prompting style/personality — extended with new data,
  not rewritten
