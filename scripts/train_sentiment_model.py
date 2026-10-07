"""
Trains a TF-IDF + LogisticRegression sentiment classifier on
data/travel_reviews.csv and serializes it to
analytics/models/sentiment_model.pkl.

Run from the repo root:
    python scripts/train_sentiment_model.py
"""
import joblib
import pandas as pd
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report


def load_training_data():
    standard_path = Path("data/travel_reviews.csv")
    tripadvisor_path = Path("data/tripadvisor_hotel_reviews_dataset_sample.csv")

    if standard_path.exists():
        df = pd.read_csv(standard_path)
        required_columns = {"review_text", "sentiment_label"}
        missing_columns = required_columns - set(df.columns)
        if missing_columns:
            raise ValueError(
                f"{standard_path} is missing required columns: "
                f"{', '.join(sorted(missing_columns))}"
            )
        return df["review_text"], df["sentiment_label"]

    if tripadvisor_path.exists():
        df = pd.read_csv(tripadvisor_path)
        required_columns = {"review_text", "rating"}
        missing_columns = required_columns - set(df.columns)
        if missing_columns:
            raise ValueError(
                f"{tripadvisor_path} is missing required columns: "
                f"{', '.join(sorted(missing_columns))}"
            )

        ratings = pd.to_numeric(df["rating"], errors="coerce")
        valid_rows = df["review_text"].notna() & ratings.notna()
        reviews = df.loc[valid_rows, "review_text"].astype(str)
        labels = ratings.loc[valid_rows].map(
            lambda rating: (
                "negative" if rating <= 2
                else "neutral" if rating == 3
                else "positive"
            )
        )
        return reviews, labels

    raise FileNotFoundError(
        "No sentiment dataset found. Add data/travel_reviews.csv or "
        "data/tripadvisor_hotel_reviews_dataset_sample.csv."
    )


def main():
    X, y = load_training_data()

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
