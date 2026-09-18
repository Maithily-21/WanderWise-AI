let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";

function setPrompt(text) {
    document.getElementById("userInput").value = text;
}

function setLoading(isLoading) {
    const sendBtn = document.getElementById("sendBtn");
    const btnText = document.getElementById("btnText");
    const btnLoader = document.getElementById("btnLoader");

    sendBtn.disabled = isLoading;

    if (isLoading) {
        btnText.classList.add("hidden");
        btnLoader.classList.remove("hidden");
    } else {
        btnText.classList.remove("hidden");
        btnLoader.classList.add("hidden");
    }
}

function showError(message) {
    const errorBox = document.getElementById("errorBox");

    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
}

function hideError() {
    const errorBox = document.getElementById("errorBox");

    errorBox.classList.add("hidden");
    errorBox.textContent = "";
}

function showResult(answer, threadId) {
    latestAnswerMarkdown = answer;

    const resultSection = document.getElementById("resultSection");
    const resultBox = document.getElementById("resultBox");
    const threadInfo = document.getElementById("threadInfo");

    if (typeof marked !== "undefined") {
        resultBox.innerHTML = marked.parse(answer);
    } else {
        resultBox.innerText = answer;
    }

    threadInfo.textContent = `Thread ID: ${threadId}`;

    resultSection.classList.remove("hidden");

    resultSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

// NEW: renders the added Analytics Layer output (price prediction,
// hotel-review sentiment, recommended attractions). Degrades quietly
// if the analytics models haven't been trained yet (stub-v0).
function showInsights(pricePrediction, sentimentSummary, recommendedAttractions) {
    const section = document.getElementById("insightsSection");
    const box = document.getElementById("insightsBox");

    let html = "";

    if (pricePrediction) {
        const price = pricePrediction.estimated_price_usd;
        html += `<div class="insight-card">
            <h3>💰 Price Estimate</h3>
            <p>${price !== null && price !== undefined
                ? `~$${price} <span class="insight-note">(historical estimate, not a live quote)</span>`
                : `Not available yet — ${pricePrediction.note || "no trained model"}`}</p>
        </div>`;
    }

    if (sentimentSummary && sentimentSummary.sample_size > 0) {
        const label = sentimentSummary.label;
        html += `<div class="insight-card">
            <h3>⭐ Hotel Review Sentiment</h3>
            <p>${label === "not_yet_analyzed"
                ? `Analyzed ${sentimentSummary.sample_size} snippet(s) — train the sentiment model for real scores.`
                : `${label} (score: ${sentimentSummary.average_score}, n=${sentimentSummary.sample_size})`}</p>
        </div>`;
    }

    if (recommendedAttractions && recommendedAttractions.length > 0) {
        const items = recommendedAttractions
            .slice(0, 5)
            .map(a => `<li>${a.name}${a.rate ? ` <span class="insight-note">(rating tier: ${a.rate})</span>` : ""}</li>`)
            .join("");
        html += `<div class="insight-card">
            <h3>📍 Top Recommended Attractions</h3>
            <ul>${items}</ul>
        </div>`;
    }

    if (!html) {
        section.classList.add("hidden");
        return;
    }

    box.innerHTML = html;
    section.classList.remove("hidden");
}

async function sendMessage() {
    hideError();

    const input = document.getElementById("userInput");
    const message = input.value.trim();

    if (!message) {
        showError("Please enter your travel request first.");
        return;
    }

    setLoading(true);

    try {
        const response = await fetch("/api/travel", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: message,
                thread_id: currentThreadId
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Something went wrong.");
        }

        currentThreadId = data.thread_id;
        localStorage.setItem("travel_thread_id", currentThreadId);

        showResult(data.answer, data.thread_id);
        showInsights(data.price_prediction, data.sentiment_summary, data.recommended_attractions);

    } catch (error) {
        showError(error.message);
    } finally {
        setLoading(false);
    }
}

function copyResult() {
    const resultBox = document.getElementById("resultBox");
    const text = resultBox.innerText;

    if (!text) {
        return;
    }

    navigator.clipboard.writeText(text)
        .then(() => {
            const copyBtn = document.querySelector(".copy-btn");
            const oldText = copyBtn.textContent;

            copyBtn.textContent = "Copied!";

            setTimeout(() => {
                copyBtn.textContent = oldText;
            }, 1400);
        })
        .catch(() => {
            showError("Could not copy result.");
        });
}

function downloadPDF() {
    const pdfContent = document.getElementById("pdfContent");

    if (!latestAnswerMarkdown || !pdfContent) {
        showError("No travel plan available to download.");
        return;
    }

    const downloadBtn = document.querySelector(".download-btn");
    const oldText = downloadBtn.textContent;

    downloadBtn.textContent = "Preparing PDF...";
    downloadBtn.disabled = true;

    const options = {
        margin: 0.5,
        filename: "ai-travel-plan.pdf",
        image: {
            type: "jpeg",
            quality: 0.98
        },
        html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff"
        },
        jsPDF: {
            unit: "in",
            format: "a4",
            orientation: "portrait"
        },
        pagebreak: {
            mode: ["avoid-all", "css", "legacy"]
        }
    };

    html2pdf()
        .set(options)
        .from(pdfContent)
        .save()
        .then(() => {
            downloadBtn.textContent = oldText;
            downloadBtn.disabled = false;
        })
        .catch(() => {
            downloadBtn.textContent = oldText;
            downloadBtn.disabled = false;
            showError("Could not download PDF.");
        });
}

document.addEventListener("keydown", function(event) {
    if (event.ctrlKey && event.key === "Enter") {
        sendMessage();
    }
});