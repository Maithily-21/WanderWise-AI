import os
import certifi
from dotenv import load_dotenv

load_dotenv()

os.environ["SSL_CERT_FILE"] = certifi.where()
os.environ["REQUESTS_CA_BUNDLE"] = certifi.where()

from typing import TypedDict, Annotated, Optional
import operator
import uuid

import psycopg
from psycopg.rows import dict_row

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.postgres import PostgresSaver
from langchain_core.messages import (
    AnyMessage,
    HumanMessage,
    AIMessage,
    SystemMessage,
)
from langchain_groq import ChatGroq
from tools.tavily_tool import tavily_search
from tools.flight_tool import search_flights
from tools.weather_tool import get_weather_forecast
from tools.local_info_tool import get_local_attractions, get_attractions_structured
from tools.location_resolver import resolve_trip_locations
from analytics.price_prediction import price_predictor
from analytics.sentiment_analysis import sentiment_analyzer
from analytics.recommendation_engine import rank_attractions


def get_database_url():
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise ValueError(
            "DATABASE_URL is missing. Please add your Render PostgreSQL External Database URL to .env"
        )

    if "sslmode=" not in database_url:
        separator = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{separator}sslmode=require"

    return database_url


GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY is missing. Please add it to your .env file.")


# =========================
# LLM
# =========================

llm = ChatGroq(
    model="openai/gpt-oss-120b",
    api_key=GROQ_API_KEY
)


# =========================
# State
# =========================
#
# ADDED vs. the original: weather_results, local_info_results,
# price_prediction, sentiment_summary, recommended_attractions.
#
# `llm_calls` changed to an Annotated int with operator.add: now that
# flight/hotel/weather/local_info agents run in the SAME superstep
# (parallel fan-out from START), LangGraph requires a reducer for any
# key more than one node writes concurrently — without one it raises
# an INVALID_CONCURRENT_GRAPH_UPDATE error. Each node now returns a
# delta (1) instead of `state.get("llm_calls", 0) + 1`, and the
# reducer sums them.

class TravelState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    user_query: str
    flight_results: str
    hotel_results: str
    weather_results: str
    local_info_results: str
    itinerary: str
    price_prediction: Optional[dict]
    sentiment_summary: Optional[dict]
    recommended_attractions: Optional[list]
    llm_calls: Annotated[int, operator.add]


# =========================
# Flight Agent
# =========================

def flight_agent(state: TravelState):
    query = state["user_query"]
    flight_data = search_flights(query)

    return {
        "flight_results": flight_data,
        "messages": [
            AIMessage(content="Flight results fetched.")
        ],
        "llm_calls": 1,
    }


# =========================
# Hotel Agent
# =========================

def hotel_agent(state: TravelState):
    query = f"Best hotels for {state['user_query']}"
    hotel_results = tavily_search(query)

    return {
        "hotel_results": hotel_results,
        "messages": [
            AIMessage(content="Hotel information fetched.")
        ],
        "llm_calls": 1,
    }


# =========================
# Weather Agent  (NEW)
# =========================

def weather_agent(state: TravelState):
    locations = resolve_trip_locations(state["user_query"])
    weather_data = get_weather_forecast(
        locations["destination_city"], locations["destination_country"]
    )

    return {
        "weather_results": weather_data,
        "messages": [
            AIMessage(content="Weather forecast fetched.")
        ],
        "llm_calls": 1,
    }


# =========================
# Local Info Agent  (NEW)
# =========================

def local_info_agent(state: TravelState):
    locations = resolve_trip_locations(state["user_query"])
    local_info_data = get_local_attractions(locations["destination_city"])

    structured = get_attractions_structured(locations["destination_city"]) \
        if locations["destination_city"] else []
    ranked = rank_attractions(structured) if structured else []

    return {
        "local_info_results": local_info_data,
        "recommended_attractions": ranked,
        "messages": [
            AIMessage(content="Local attractions fetched.")
        ],
        "llm_calls": 1,
    }


# =========================
# Itinerary Agent
# =========================
# UPDATED: now also incorporates weather_results and local_info_results
# (previously only had flight + hotel to work with).

def itinerary_agent(state: TravelState):
    prompt = f"""
Create a complete travel itinerary.

User Query:
{state['user_query']}

Flight Results:
{state['flight_results']}

Hotel Results:
{state['hotel_results']}

Weather Forecast:
{state['weather_results']}

Local Attractions:
{state['local_info_results']}

Make the itinerary practical, budget-aware, weather-appropriate, and
easy to follow. Reference specific attractions from the list above
where relevant to each day.
"""

    response = llm.invoke([
        SystemMessage(content="You are an expert travel planner."),
        HumanMessage(content=prompt)
    ])

    return {
        "itinerary": response.content,
        "messages": [response],
        "llm_calls": 1,
    }


# =========================
# Analytics Node  (NEW)
# =========================
# Runs price prediction + sentiment analysis. Both are trainable —
# see analytics/*.py and data/README.md — and fall back to a labeled
# stub if you haven't trained them yet, so this never breaks the run.

def analytics_node(state: TravelState):
    locations = resolve_trip_locations(state["user_query"])

    price_result = price_predictor.predict(
        origin_iata=locations["origin_iata"],
        destination_iata=locations["destination_iata"],
    )
    sentiment_result = sentiment_analyzer.score_hotel_results(state["hotel_results"])

    return {
        "price_prediction": price_result,
        "sentiment_summary": sentiment_result,
        "llm_calls": 0,
    }


# =========================
# Final Response Agent
# =========================
# UPDATED: prompt now also surfaces price prediction + sentiment.

def final_agent(state: TravelState):
    price_pred = state.get("price_prediction") or {}
    sentiment = state.get("sentiment_summary") or {}

    final_prompt = f"""
Generate the final travel response for the user.

User Request:
{state['user_query']}

Flights:
{state['flight_results']}

Hotels:
{state['hotel_results']}

Weather:
{state['weather_results']}

Local Attractions:
{state['local_info_results']}

Itinerary:
{state['itinerary']}

Price Prediction (estimated fare from historical patterns — AviationStack doesn't provide ticket prices):
{price_pred}

Hotel Review Sentiment (from search snippets, model_version={sentiment.get('model_version', 'n/a')}):
{sentiment}

Format the final answer beautifully using these sections:

1. Trip Summary
2. Flight Information
3. Hotel Suggestions (mention overall review sentiment briefly if available)
4. Weather Outlook
5. Local Attractions
6. Day-by-Day Itinerary
7. Estimated Budget (mention the price prediction if available, and note it's a historical-pattern estimate, not a live quote)
8. Final Recommendations

Important:
- Be clear and practical.
- Mention that live flight API may not provide ticket prices if pricing is unavailable.
- If price_prediction's model_version is "stub-v0", don't state a specific number — say a trained estimate isn't available yet.
- Keep the response useful for real travel planning.
"""

    response = llm.invoke([
        SystemMessage(content="You are a professional AI travel booking assistant."),
        HumanMessage(content=final_prompt)
    ])

    return {
        "messages": [response],
        "llm_calls": 1,
    }


# =========================
# Build Graph
# =========================
# UPDATED shape (was purely sequential):
#
#              START
#                |
#     -------------------------------
#     |        |         |          |
# flight_agent hotel_agent weather_agent local_info_agent   (parallel)
#     -------------------------------
#                |
#          itinerary_agent   (fan-in)
#                |
#          analytics_node
#                |
#            final_agent
#                |
#               END

graph = StateGraph(TravelState)

graph.add_node("flight_agent", flight_agent)
graph.add_node("hotel_agent", hotel_agent)
graph.add_node("weather_agent", weather_agent)
graph.add_node("local_info_agent", local_info_agent)
graph.add_node("itinerary_agent", itinerary_agent)
graph.add_node("analytics_node", analytics_node)
graph.add_node("final_agent", final_agent)

for agent_name in ["flight_agent", "hotel_agent", "weather_agent", "local_info_agent"]:
    graph.add_edge(START, agent_name)
    graph.add_edge(agent_name, "itinerary_agent")

graph.add_edge("itinerary_agent", "analytics_node")
graph.add_edge("analytics_node", "final_agent")
graph.add_edge("final_agent", END)


# =========================
# PostgreSQL Checkpointer
# =========================
DATABASE_URL = get_database_url()

if "user:password@host" in DATABASE_URL:
    from langgraph.checkpoint.memory import MemorySaver
    checkpointer = MemorySaver()
else:
    _conn = psycopg.connect(
        DATABASE_URL,
        autocommit=True,
        row_factory=dict_row
    )
    checkpointer = PostgresSaver(_conn)
    checkpointer.setup()

travel_graph = graph.compile(checkpointer=checkpointer)


# =========================
# Structured persistence  (NEW)
# =========================
# Separate from the checkpointer above (which only stores LangGraph's
# internal state snapshots). This writes one queryable row per run to
# travel_plan_records — see db/models.py.

def _persist_plan_record(thread_id: str, user_query: str, result: dict):
    if "user:password@host" in get_database_url():
        return
    try:
        from db.database import SessionLocal, Base, engine
        from db.models import TravelPlanRecord

        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        try:
            record = TravelPlanRecord(
                thread_id=thread_id,
                user_query=user_query,
                flight_results=result.get("flight_results", ""),
                hotel_results=result.get("hotel_results", ""),
                weather_results=result.get("weather_results", ""),
                local_info_results=result.get("local_info_results", ""),
                itinerary=result.get("itinerary", ""),
                final_answer=result.get("answer", ""),
                price_prediction=result.get("price_prediction"),
                sentiment_summary=result.get("sentiment_summary"),
                llm_calls=result.get("llm_calls", 0),
            )
            db.add(record)
            db.commit()
        finally:
            db.close()
    except Exception as e:
        # Non-fatal: the API response already succeeded via the
        # checkpointer path above; structured persistence is a bonus.
        print(f"[persist_plan_record] Failed to persist structured record: {e}")


# =========================
# Function for FastAPI
# =========================

def run_travel_agent(user_input: str, thread_id: str | None = None):
    if not thread_id:
        thread_id = f"user_{uuid.uuid4().hex}"

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    result = travel_graph.invoke(
        {
            "messages": [
                HumanMessage(content=user_input)
            ],
            "user_query": user_input,
            "flight_results": "",
            "hotel_results": "",
            "weather_results": "",
            "local_info_results": "",
            "itinerary": "",
            "price_prediction": None,
            "sentiment_summary": None,
            "recommended_attractions": None,
            "llm_calls": 0
        },
        config=config
    )

    final_answer = result["messages"][-1].content

    output = {
        "thread_id": thread_id,
        "answer": final_answer,
        "flight_results": result.get("flight_results", ""),
        "hotel_results": result.get("hotel_results", ""),
        "weather_results": result.get("weather_results", ""),
        "local_info_results": result.get("local_info_results", ""),
        "itinerary": result.get("itinerary", ""),
        "price_prediction": result.get("price_prediction"),
        "sentiment_summary": result.get("sentiment_summary"),
        "recommended_attractions": result.get("recommended_attractions"),
        "llm_calls": result.get("llm_calls", 0),
    }

    _persist_plan_record(thread_id, user_input, output)

    return output
