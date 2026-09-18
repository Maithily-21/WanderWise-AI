"""
Trains a TF-IDF + LogisticRegression sentiment classifier on
data/travel_reviews.csv and serializes it to
analytics/models/sentiment_model.pkl.

Run from the repo root:
    python scripts/train_sentiment_model.py
"""
import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report


def main():
    df = pd.read_csv("data/travel_reviews.csv")
    X = df["review_text"]
    y = df["sentiment_label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=5000)),
        ("clf", LogisticRegression(max_iter=1000, class_weight="balanced")),
    ])

    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    print(classification_report(y_test, preds))

    joblib.dump(model, "analytics/models/sentiment_model.pkl")
    print("Saved analytics/models/sentiment_model.pkl")


if __name__ == "__main__":
    main()
