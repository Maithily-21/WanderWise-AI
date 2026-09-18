# ✈️ TripMate AI — A Multi-Agent Travel Planner with LangGraph

> **This is an enhanced fork of [entbappy/TripMate-AI](https://github.com/entbappy/TripMate-AI-A-Multi-Agent-Travel-Planner-with-LangGraph).**
> Everything below marked **[added]** is new; everything marked
> **[original]** is unchanged from the base repo. See
> [`CHANGES.md`](./CHANGES.md) for a full diff-level summary.

An open-source AI travel planner that turns a natural-language trip request into a practical travel plan with flight suggestions, hotel ideas, weather-aware and attraction-aware day-by-day itinerary, and trip-level analytics.

## Why this project?

Planning a trip usually means jumping between multiple websites, tools, and spreadsheets. This project brings that flow into one experience by combining:

- a flight-search agent, **[original]**
- a hotel-research agent, **[original]**
- a weather-forecast agent, **[added]**
- a local-attractions agent, **[added]**
- an itinerary-planning agent, **[original, now weather- and attraction-aware]**
- an analytics layer (price estimate + review sentiment), **[added]**
- and a final response agent, **[original]**

all coordinated through a LangGraph workflow that now fans out to all four data-gathering agents in parallel, rather than running them one after another.

## Features

- ✈️ Flight research using AviationStack **[original]**
- 🏨 Hotel suggestions using Tavily search **[original]**
- 🌦️ Weather forecast via OpenWeatherMap **[added]**
- 📍 Local attractions via OpenTripMap, ranked by rating **[added]**
- 💰 Historical flight-price estimation (trainable XGBoost model) **[added]**
- ⭐ Hotel-review sentiment analysis, scored from live Tavily snippets (trainable TF-IDF + LogisticRegression model) **[added]**
- 🧠 Multi-agent orchestration with LangGraph — now with parallel fan-out **[original workflow, added parallelism]**
- 📝 Structured, weather- and attraction-aware travel itinerary generation **[original, enhanced]**
- 🌐 FastAPI backend with a simple web interface, now showing a Trip Insights panel **[original, enhanced]**
- 💾 Two persistence layers: LangGraph conversation checkpoints **[original]** + a queryable `travel_plan_records` table **[added]**
- 📊 `/api/analytics/dashboard-summary` endpoint **[added]**
- ⚡ LLM-powered responses with Groq **[original]**

## Tech Stack

- Python 3.10+
- FastAPI
- Jinja2 + HTML/CSS/JavaScript frontend
- LangGraph, LangChain, Groq LLMs
- PostgreSQL
- Tavily API, AviationStack API **[original]**
- OpenWeatherMap API, OpenTripMap API **[added]**
- SQLAlchemy, scikit-learn, XGBoost, pandas, numpy **[added]**

## Project Structure

```text
.
├── app.py                       FastAPI app entry point
├── backend.py                   LangGraph travel workflow (restructured — see below)
├── requirements.txt
├── static/                      Static frontend assets (extended with Trip Insights panel)
├── templates/                   HTML templates (extended)
├── tools/
│   ├── flight_tool.py           [original]
│   ├── tavily_tool.py           [original]
│   ├── weather_tool.py          [added] OpenWeatherMap client
│   ├── local_info_tool.py       [added] OpenTripMap client
│   └── location_resolver.py     [added] shared destination resolution
├── analytics/                   [added] Analytics Layer
│   ├── price_prediction.py      trainable XGBoost regressor, stub fallback
│   ├── sentiment_analysis.py    trainable TF-IDF+LogReg, stub fallback
│   ├── recommendation_engine.py ranks attractions by rating
│   └── models/                  trained .pkl files land here (gitignored)
├── db/                          [added] structured persistence
│   ├── database.py              SQLAlchemy engine (separate from the LangGraph checkpointer)
│   └── models.py                travel_plan_records table
├── data/                        [added] EMPTY — put your own datasets here (see data/README.md)
└── scripts/                     [added]
    ├── train_price_model.py
    └── train_sentiment_model.py
```

## Prerequisites

- Python 3.10 or newer
- PostgreSQL running and accessible
- API keys for: Groq, Tavily, AviationStack **[original]**, OpenWeatherMap, OpenTripMap **[added]**

## Environment Variables

Copy `.env.example` to `.env` and fill in your values — it documents
every key (original and added) with sign-up links.

## Installation

```bash
python -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Running the App

```bash
python app.py
```

Then open `http://127.0.0.1:8000/`.

## API Endpoints

- `GET /health` — health check **[original]**
- `POST /api/travel` — submit a travel request; response now also
  includes `weather_results`, `local_info_results`, `price_prediction`,
  `sentiment_summary`, `recommended_attractions` **[original endpoint, extended response]**
- `GET /api/analytics/dashboard-summary` — aggregate stats across all
  stored plans **[added]**

Example request (unchanged):
```bash
curl -X POST http://127.0.0.1:8000/api/travel \
  -H "Content-Type: application/json" \
  -d '{"message":"Plan a 3-day trip to Tokyo with a budget of $1200"}'
```

## How the Workflow Works

**[original: 1→2→3→4→5 sequential]** **[added: agents 2-5 now run in parallel, plus a new analytics step]**

```
                 START
                   |
     -------------------------------
     |        |         |          |
flight_agent hotel_agent weather_agent local_info_agent   (parallel — added weather + local info)
     -------------------------------
                   |
             itinerary_agent   (fan-in; now weather- and attraction-aware)
                   |
             analytics_node    (added — price estimate + sentiment)
                   |
               final_agent
                   |
                  END
```

1. The user submits a travel request.
2. Flight, hotel, weather, and local-info agents run **simultaneously** (previously sequential).
3. The itinerary agent creates a practical, weather-appropriate plan referencing real nearby attractions.
4. **[added]** The analytics node estimates a historical fare and scores hotel-review sentiment from the live Tavily snippets.
5. The final agent formats everything — including the price estimate and sentiment — into a polished response.
6. **[added]** A structured row is written to `travel_plan_records`, independent of LangGraph's own conversation checkpoint.

## Training the analytics models

`data/` ships empty — see `data/README.md` for the exact CSV columns
expected. Once you've added your datasets:

```bash
python scripts/train_price_model.py
python scripts/train_sentiment_model.py
```

Each writes a `.pkl` to `analytics/models/`. The moment that file
exists, `analytics/price_prediction.py` / `sentiment_analysis.py`
automatically load and use it — no code changes needed. Until then,
both fall back to a clearly labeled placeholder
(`model_version: "stub-v0"`) so the app works end-to-end regardless.

**Known limitation, called out honestly:** AviationStack (used by the
original flight agent) provides live flight *status* data, not ticket
*prices* — this is stated directly in `tools/flight_tool.py`'s own
output text. So "price prediction" here is a historical-pattern
estimate for the route, not a comparison against a real live fare the
flight agent found. See `analytics/price_prediction.py` for details.

## Known gaps / things to be aware of

- **Destination parsing**: the original `flight_tool.parse_route()`
  can fail to resolve a destination for queries where it's named
  without an explicit "to" (e.g. "Japan trip from Bangladesh" — the
  app's own suggested example). `tools/location_resolver.py` works
  around this for the new Weather/Local Info agents and analytics
  node, but `flight_agent` itself still uses the original parsing
  as-is.
- **Sentiment analysis input**: scored from Tavily's hotel-search
  snippets at request time, not a dedicated review dataset — this
  means sentiment reflects whatever Tavily's top search results say,
  which may be thin or off-topic for less-searched destinations.
- **No explicit travel dates**: the natural-language query doesn't
  carry a structured date, so price prediction assumes a fixed
  "30 days ahead" horizon. Wire in real date parsing if you need
  date-specific estimates.

## Contributing / Acknowledgments

Same as upstream — see [`CHANGES.md`](./CHANGES.md) for what's new in
this fork specifically.
