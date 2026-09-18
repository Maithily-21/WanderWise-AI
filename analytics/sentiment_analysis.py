"""
ANALYTICS LAYER — Sentiment Analysis

Unlike a typical setup with a dedicated review dataset feeding a live
"reviews" table, this repo's hotel_agent already returns free text —
Tavily search snippets about hotels (see tools/tavily_tool.py). This
module scores THOSE snippets at request time, so sentiment output is
real (not just a placeholder) even before you've trained anything —
though an untrained model falls back to a neutral stub, see below.

Loads a trained TF-IDF + LogisticRegression pipeline from
analytics/models/sentiment_model.pkl (trained by
scripts/train_sentiment_model.py on data/travel_reviews.csv, which
YOU provide — see data/README.md).
"""
from pathlib import Path
import re

import joblib

MODEL_PATH = Path(__file__).parent / "models" / "sentiment_model.pkl"

LABEL_TO_SCORE = {"positive": 1.0, "neutral": 0.0, "negative": -1.0}


def split_into_snippets(tavily_formatted_text: str) -> list[str]:
    """
    tools/tavily_tool.py formats each result as:
        "1. **Title**\\n   url\\n   snippet"
    joined by "\\n\\n". This pulls just the snippet lines back out.
    """
    if not tavily_formatted_text:
        return []
    blocks = tavily_formatted_text.split("\n\n")
    snippets = []
    for block in blocks:
        lines = [l.strip() for l in block.strip().split("\n") if l.strip()]
        # Expected shape: ["1. **Title**", "https://...", "snippet text..."]
        for line in lines[2:]:
            if line and not re.match(r"^https?://", line):
                snippets.append(line)
    return snippets


class SentimentAnalyzer:
    def __init__(self):
        self.model = None
        self.model_version = "stub-v0"
        if MODEL_PATH.exists():
            try:
                self.model = joblib.load(MODEL_PATH)
                self.model_version = "tfidf-logreg-v1"
            except Exception as e:
                print(f"[sentiment_analysis] Failed to load trained model, using stub: {e}")

    def score_hotel_results(self, hotel_results_text: str) -> dict:
        snippets = split_into_snippets(hotel_results_text)

        if not snippets:
            return {"average_score": None, "label": "no_data", "sample_size": 0, "model_version": self.model_version}

        if self.model is not None:
            labels = self.model.predict(snippets)
            scores = [LABEL_TO_SCORE[l] for l in labels]
            avg = sum(scores) / len(scores)
            overall = "positive" if avg > 0.15 else "negative" if avg < -0.15 else "neutral"
            return {
                "average_score": round(avg, 3),
                "label": overall,
                "sample_size": len(snippets),
                "model_version": self.model_version,
            }

        return {
            "average_score": 0.0,
            "label": "not_yet_analyzed",
            "sample_size": len(snippets),
            "model_version": self.model_version,
        }


sentiment_analyzer = SentimentAnalyzer()
