\# Task: Improve Price Prediction Model Accuracy in WanderWise-AI



Act as a \*\*Senior Machine Learning Engineer specializing in regression, predictive modeling, feature engineering, and production ML systems\*\*.



I am working on the WanderWise-AI project. My primary goal is to significantly improve the accuracy and reliability of its existing price prediction model while preserving the current application's functionality, architecture, and UI integration.



\## 1. First, Understand the Existing Project



Before making any changes, thoroughly inspect the repository.



\* Locate the price prediction model, training scripts, datasets, preprocessing pipelines, feature engineering code, evaluation logic, prediction API, and frontend integration.

\* Identify the target variable, input features, prediction unit/currency, model type, and how predictions are generated.

\* Understand the complete flow from user input to the final predicted price.

\* Inspect existing dependencies, saved model files, API request/response formats, and data schemas.

\* Read the relevant code before proposing or implementing changes.



\*\*Do not assume which algorithm, dataset, framework, or evaluation metric is currently being used. Discover these from the repository.\*\*



Establish a baseline using the existing model before changing anything. Record its evaluation metrics and any existing limitations.



\## 2. Diagnose Why the Model Has Poor Accuracy



Perform a systematic investigation instead of randomly changing algorithms.



Examine:



\* Missing values, duplicate records, incorrect data types, inconsistent units, invalid prices, and outliers.

\* Target distribution, skewness, extreme values, and possible data quality problems.

\* Whether the training dataset is sufficiently large, representative, and relevant to real-world predictions.

\* Whether important predictive features are missing or incorrectly encoded.

\* Whether categorical features are handled appropriately.

\* Whether numerical features need transformations or scaling for the selected algorithm.

\* Whether train/test splitting causes leakage or produces an unrealistic evaluation.

\* Whether training and inference use identical preprocessing and feature ordering.

\* Whether the current model is overfitting or underfitting.

\* Whether the evaluation metric accurately reflects prediction quality.

\* Whether the model is being tested on data representative of the inputs users actually provide.



Identify the most important root causes and prioritize fixes based on evidence.



\## 3. Improve Feature Engineering



Inspect the available data and create useful features only when they are supported by the dataset and prediction problem.



Potential improvements include:



\* Correct handling of numerical and categorical variables.

\* More informative combinations or transformations of existing features.

\* Log transformation of a highly skewed target, if justified.

\* Missing-value imputation and outlier treatment, fitted only on training data.

\* Domain-specific features that capture important price drivers.

\* Appropriate encoding for high-cardinality categorical variables.

\* Feature selection or regularization where it improves generalization.



Avoid generating arbitrary features or removing potentially valuable information without validation.



Prevent data leakage at every stage.



\## 4. Evaluate and Compare Multiple Models



Use the algorithms appropriate to the existing task and data. For a tabular regression problem, consider candidates such as:



\* The current model as the baseline.

\* Linear Regression or Ridge Regression as a simple benchmark.

\* Random Forest Regressor.

\* Gradient boosting models such as HistGradientBoostingRegressor.

\* XGBoost, LightGBM, or CatBoost if compatible with the project and available dependencies.



Do not add every algorithm automatically. Select a reasonable set of candidates based on dataset size, feature types, runtime, existing dependencies, and the current model.



Use a reproducible experimental setup with appropriate validation and consistent evaluation data.



Compare the models using:



\* \*\*MAE:\*\* Average absolute prediction error, expressed in the target's units.

\* \*\*RMSE:\*\* Penalizes large prediction errors more heavily.

\* \*\*R²:\*\* Measures performance relative to a mean-prediction baseline.

\* \*\*MAPE or sMAPE:\*\* Only when appropriate for the target distribution; handle zero and near-zero actual prices correctly.



Create a comparison table containing model name, MAE, RMSE, R², and relevant training or inference costs.



Select the final model based on validation performance, generalization, reliability, and operational requirements—not training accuracy alone.



\## 5. Use Sound Validation and Hyperparameter Tuning



\* Create a reproducible train/validation/test strategy.

\* Keep the test set untouched until final model selection.

\* Use cross-validation when suitable for the dataset size and structure.

\* Use randomized search, grid search, or another appropriate tuning strategy with sensible computational limits.

\* Set random seeds wherever applicable.

\* If the data has a temporal structure, use time-aware splitting rather than random splitting.

\* If multiple records belong to the same entity, consider group-aware splitting where appropriate.

\* Check for duplicate or near-duplicate records crossing dataset splits.



Never tune the model against the final test set.



\## 6. Improve Prediction Reliability



Investigate whether the model produces unrealistic predictions, including negative prices where negative values are invalid for the domain.



Where appropriate:



\* Apply justified target transformations or domain-aware prediction constraints.

\* Check predictions for implausible magnitudes.

\* Detect inputs that are missing required fields or outside the training distribution.

\* Handle invalid user inputs with clear errors.

\* Avoid silently returning fabricated or hardcoded predictions.

\* Provide a useful fallback or explicit warning when a prediction cannot be trusted.



If feasible, estimate prediction uncertainty or provide an error range using a defensible validation-based method. Clearly explain that an estimated range is not a guarantee.



\## 7. Preserve the Existing Application



This is an improvement to an existing project, not a request to rebuild it.



\* Preserve existing routes, API contracts, request/response schemas, and frontend behavior.

\* Do not remove existing features or redesign the UI unnecessarily.

\* Preserve compatibility with the current application framework and deployment setup.

\* Ensure the inference pipeline loads the correct trained model and uses the same preprocessing as training.

\* Save the complete fitted preprocessing and model pipeline using the project's established model persistence approach.

\* Update dependencies only when necessary.

\* Do not commit datasets, credentials, API keys, or unnecessarily large artifacts.

\* If model filenames or API responses must change, update all dependent code consistently.



\## 8. Make the Improvements and Verify Them



After completing the diagnosis:



1\. Explain the root causes you discovered.

2\. Implement the highest-impact, evidence-based improvements.

3\. Train and evaluate the improved model.

4\. Compare its performance against the original baseline on the same evaluation data.

5\. Add or update tests for preprocessing, model loading, prediction generation, and API integration where appropriate.

6\. Run the available tests and relevant application checks.

7\. Verify that the frontend can still obtain predictions through the existing interface.

8\. Document the training command, required dataset location, model artifact location, evaluation results, and inference procedure.



Do not claim an accuracy improvement unless the evaluation results demonstrate it. If the improved model performs worse, investigate the reason and retain the better validated model.



\## 9. Final Report



When finished, provide:



\* Root causes of poor prediction quality.

\* Files inspected and files modified.

\* Original baseline metrics.

\* Final model and its hyperparameters.

\* Before-and-after MAE, RMSE, and R².

\* Any data leakage, data quality, or generalization issues discovered.

\* Exact commands to retrain and evaluate the model.

\* Any additional dependencies or dataset requirements.

\* Confirmation that existing API and frontend integration still work.

\* Remaining limitations and recommended next steps.



\## Critical Instructions



\* Begin with repository inspection and diagnosis.

\* Do not rewrite the entire project.

\* Do not fabricate datasets, metrics, accuracy percentages, or test results.

\* Do not use the test set to select hyperparameters.

\* Do not introduce target leakage or preprocessing leakage.

\* Do not sacrifice reproducibility for a superficially higher score.

\* Do not stop after providing recommendations: implement and verify the changes when the environment permits.

\* If a necessary dataset, API key, dependency, or external resource is unavailable, explain the blocker instead of pretending the task is complete.



\*\*Success criterion:\*\* Deliver the best defensible, reproducible improvement over the existing price prediction baseline while maintaining compatibility with WanderWise-AI.



