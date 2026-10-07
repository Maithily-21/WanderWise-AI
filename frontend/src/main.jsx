import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import './style.css';

// Markdown setup
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Helper: Parse weather string
function parseWeatherData(weatherText) {
  if (!weatherText || typeof weatherText !== 'string') return [];
  const lines = weatherText.split('\n');
  const results = [];
  const regex = /[-*]\s*(\d{4}-\d{2}-\d{2}):\s*([^,]+),\s*(-?\d+°C)\s*to\s*(-?\d+°C)/i;
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      results.push({
        date: match[1],
        condition: match[2].trim(),
        minTemp: match[3],
        maxTemp: match[4],
      });
    }
  }
  return results;
}

// Helper: Parse flights string
function parseFlightData(flightText) {
  if (!flightText || typeof flightText !== 'string') return [];
  const flights = [];
  const blocks = flightText.split(/\n---\n/);
  for (const block of blocks) {
    const airlineMatch = block.match(/Airline:\s*(.+)/i);
    const flightMatch = block.match(/Flight:\s*(.+)/i);
    const statusMatch = block.match(/Status:\s*(.+)/i);
    const scheduledMatch = block.match(/Scheduled:\s*(.+)/i);
    const iataMatch = block.match(/IATA:\s*(.+)/i);

    if (airlineMatch || flightMatch) {
      flights.push({
        airline: airlineMatch ? airlineMatch[1].trim() : 'Unknown Airline',
        flightNum: flightMatch ? flightMatch[1].trim() : '',
        status: statusMatch ? statusMatch[1].trim() : 'Scheduled',
        scheduled: scheduledMatch ? scheduledMatch[1].trim() : 'Not specified',
        route: iataMatch ? iataMatch[1].trim() : '',
      });
    }
  }
  return flights;
}

// Helper: Extract Initials
function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Privacy Policy Component
function PrivacyPage({ onBack }) {
  return (
    <main className="main-layout" id="privacy-page">
      {/* Draft, needs legal review before launch */}
      <div className="legal-page">
        <button onClick={onBack} className="btn-secondary" style={{ marginBottom: '20px' }}>
          Back to Planner
        </button>
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Effective Date: October 2026. Draft, needs legal review before launch.</p>

        <section className="legal-section">
          <h2>1. Overview</h2>
          <p>
            WanderWise AI provides travel planning assistance. This Privacy Policy describes how we collect,
            use, and handle your information when you access our web application.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Information We Collect</h2>
          <p>We collect only the information necessary to provide the travel planning service:</p>
          <ul>
            <li><strong>Account Information:</strong> When you sign in using Google OAuth, we receive your name, email address, profile picture URL, and Google user identifier.</li>
            <li><strong>Trip Inquiries:</strong> Plain-text prompts, destination preferences, and travel queries you submit in the planner.</li>
            <li><strong>Session Data:</strong> HTTP session cookies used to maintain your signed-in state.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>3. Third-Party Service Providers</h2>
          <p>To generate your travel itinerary, your trip queries are processed by the following external APIs:</p>
          <ul>
            <li><strong>Groq:</strong> Language model inference for synthesizing travel itineraries.</li>
            <li><strong>Tavily Search:</strong> Web search for current hotel and destination information.</li>
            <li><strong>AviationStack:</strong> Querying live flight status records.</li>
            <li><strong>OpenWeatherMap:</strong> Weather forecasts for the requested destination.</li>
            <li><strong>OpenTripMap:</strong> Public attraction listings and tourist ratings.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2>4. Data Storage and Retention</h2>
          <p>
            Travel plan records and LangGraph conversation checkpoint states are stored securely in a PostgreSQL database.
            We do not sell your personal data. We do not display ads or track your activity across third-party websites.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Contact</h2>
          <p>
            For privacy inquiries or data deletion requests, contact us at [CONTACT EMAIL].
          </p>
        </section>
      </div>
    </main>
  );
}

// Terms Component
function TermsPage({ onBack }) {
  return (
    <main className="main-layout" id="terms-page">
      {/* Draft, needs legal review before launch */}
      <div className="legal-page">
        <button onClick={onBack} className="btn-secondary" style={{ marginBottom: '20px' }}>
          Back to Planner
        </button>
        <h1>Terms and Conditions</h1>
        <p className="legal-meta">Effective Date: October 2026. Draft, needs legal review before launch.</p>

        <section className="legal-section">
          <h2>1. Description of Service</h2>
          <p>
            WanderWise AI is an informational tool that coordinates automated agents to generate sample travel itineraries.
            WanderWise AI is not a travel agency, airline, hotel, or booking provider.
          </p>
        </section>

        <section className="legal-section">
          <h2>2. AI-Generated Output and Accuracy Disclaimer</h2>
          <p>
            All itineraries, recommendations, hotel details, and price predictions are generated by automated systems and artificial intelligence models.
            Output may contain inaccuracies, outdated information, or hallucinations. You must independently verify all flight schedules, visa requirements,
            hotel reservations, opening hours, and safety guidelines with official providers prior to making any bookings or travel commitments.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Live Flight Status Notice</h2>
          <p>
            Flight information displayed within WanderWise AI represents live flight status data from AviationStack.
            It does not reflect live ticket prices, seat availability, or purchasing options.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. User Responsibilities</h2>
          <p>
            You agree to use WanderWise AI for lawful personal travel planning purposes only.
            You agree not to abuse or attempt to compromise our API endpoints or backend databases.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, WanderWise AI and its contributors are not liable for any direct, indirect, incidental, or consequential damages resulting from the use of or inability to use this service, or from travel decisions made based on generated itineraries.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Contact</h2>
          <p>
            For questions regarding these terms, contact [CONTACT EMAIL].
          </p>
        </section>
      </div>
    </main>
  );
}

// Main App Component
function App() {
  const [view, setView] = useState('planner'); // 'planner', 'privacy', 'terms'
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [threadId, setThreadId] = useState(null);
  const [notification, setNotification] = useState(null);
  const abortControllerRef = useRef(null);

  const user = window.USER_DATA || { name: 'Traveler', picture: '', firstName: 'Traveler' };

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash;
      if (hash === '#privacy') setView('privacy');
      else if (hash === '#terms') setView('terms');
      else setView('planner');
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const showNotification = (msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  const handlePlanTrip = async (e, customMessage = null) => {
    if (e) e.preventDefault();
    const queryText = customMessage || prompt;
    if (!queryText || !queryText.trim()) return;

    setError(null);
    setLoading(true);
    setLoadingStep('Searching flight status, hotel options, weather forecasts and attractions. Multi-agent processing may take 15 to 30 seconds.');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/travel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: queryText.trim(),
          thread_id: threadId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Server returned an error status: ' + response.status);
      }

      const data = await response.json();
      setResult(data);
      if (data.thread_id) {
        setThreadId(data.thread_id);
      }
      showNotification('Travel plan generated successfully.', 'success');
    } catch (err) {
      if (err.name === 'AbortError') {
        showNotification('Request canceled by user.', 'info');
      } else {
        setError('Unable to complete request. Please check your network connection and try again.');
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const textToCopy = result.answer || result.itinerary || '';
    if (!textToCopy) {
      showNotification('No text available to copy.', 'error');
      return;
    }
    navigator.clipboard.writeText(textToCopy)
      .then(() => {
        showNotification('Trip plan copied to clipboard.', 'success');
      })
      .catch(() => {
        showNotification('Failed to copy to clipboard.', 'error');
      });
  };

  const handlePrint = () => {
    showNotification('Opening print dialog for PDF export.', 'info');
    window.print();
  };

  if (view === 'privacy') {
    return (
      <div className="app-shell">
        <Header user={user} setView={setView} />
        <PrivacyPage onBack={() => { window.location.hash = ''; setView('planner'); }} />
        <Footer setView={setView} />
      </div>
    );
  }

  if (view === 'terms') {
    return (
      <div className="app-shell">
        <Header user={user} setView={setView} />
        <TermsPage onBack={() => { window.location.hash = ''; setView('planner'); }} />
        <Footer setView={setView} />
      </div>
    );
  }

  // Parse structured data if result exists
  const weatherList = result ? parseWeatherData(result.weather_results) : [];
  const flightList = result ? parseFlightData(result.flight_results) : [];

  // Determine price prediction visibility (Hide if stub-v0 or absent)
  const hasValidPricePrediction = result &&
    result.price_prediction &&
    result.price_prediction.model_version &&
    result.price_prediction.model_version !== 'stub-v0' &&
    result.price_prediction.predicted_fare_usd;

  // Determine sentiment visibility (Hide if sample_size <= 0 or no real label)
  const hasValidSentiment = result &&
    result.sentiment_summary &&
    result.sentiment_summary.sample_size > 0 &&
    result.sentiment_summary.sentiment_label;

  // Determine attractions visibility
  const attractionsList = (result && Array.isArray(result.recommended_attractions)) ? result.recommended_attractions : [];

  // Sanitized markdown answer
  const sanitizedMarkdown = result && result.answer
    ? DOMPurify.sanitize(marked.parse(result.answer))
    : '';

  return (
    <div className="app-shell">
      <Header user={user} setView={setView} />

      <main className="main-layout" id="main-content">
        {notification && (
          <div className={`inline-notification ${notification.type}`} role="status">
            <span>{notification.msg}</span>
            <button
              onClick={() => setNotification(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              aria-label="Dismiss notification"
            >
              Close
            </button>
          </div>
        )}

        <section className="prompt-card" aria-labelledby="prompt-heading">
          <h1 id="prompt-heading" className="prompt-title">Plan Your Trip</h1>
          <p className="prompt-description">
            Describe your destination, dates, budget or travel style. Coordinated agents will research flights, hotels, weather and local attractions.
          </p>

          <form onSubmit={handlePlanTrip} className="prompt-form">
            <label htmlFor="trip-query" className="sr-only" style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0 }}>
              Trip description
            </label>
            <textarea
              id="trip-query"
              className="prompt-textarea"
              placeholder="Example: Plan a 4-day trip to Tokyo in November with a budget of $1500, focusing on culture, food and walking."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              rows={3}
            />

            <div className="prompt-actions">
              <div className="example-chips">
                <span className="chip-label">Suggestions:</span>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setPrompt('3-day cultural trip to Kyoto with a moderate budget')}
                >
                  3-day Kyoto
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setPrompt('Weekend trip to Chicago visiting architecture and art museums')}
                >
                  Weekend Chicago
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setPrompt('5-day family trip to London with local food and historic sites')}
                >
                  5-day London
                </button>
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={loading || !prompt.trim()}
              >
                {loading ? 'Processing...' : 'Generate Plan'}
              </button>
            </div>
          </form>
        </section>

        {loading && (
          <section className="loading-box" aria-live="polite">
            <div className="spinner" />
            <h2 className="loading-title">Generating Itinerary</h2>
            <p className="loading-detail">{loadingStep}</p>
            <button type="button" onClick={handleCancel} className="btn-secondary">
              Cancel Request
            </button>
          </section>
        )}

        {error && (
          <div className="inline-notification error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => handlePlanTrip(null)}
              className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '4px 8px' }}
            >
              Retry
            </button>
          </div>
        )}

        {result && !loading && (
          <section id="results-section" aria-labelledby="results-title">
            <div className="results-header-bar">
              <div>
                <h2 id="results-title" className="results-title">Generated Travel Plan</h2>
                <div className="results-meta">
                  Coordinated response from LangGraph agents. LLM iterations: {result.llm_calls || 1}.
                </div>
              </div>

              <div className="results-actions">
                <button type="button" onClick={handleCopy} className="btn-secondary">
                  Copy Text
                </button>
                <button type="button" onClick={handlePrint} className="btn-secondary">
                  Print / PDF
                </button>
              </div>
            </div>

            <div className="results-grid">
              {/* Left Column: Full Itinerary & Recommendations */}
              <div className="results-primary-col">
                <article className="result-card">
                  <h3 className="card-title">Day-by-Day Itinerary</h3>
                  {sanitizedMarkdown ? (
                    <div
                      className="markdown-body"
                      dangerouslySetInnerHTML={{ __html: sanitizedMarkdown }}
                    />
                  ) : (
                    <p className="notice-line">No itinerary text returned.</p>
                  )}
                  <span className="disclaimer-badge">
                    AI-generated plan. Verify flight times and booking details with official operators.
                  </span>
                </article>

                {/* Follow-up question form */}
                <div className="followup-box">
                  <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Refine or Ask a Follow-up Question</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    Your session thread ID is maintained for context continuity.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const followInput = e.target.elements.followupText;
                      if (followInput && followInput.value.trim()) {
                        handlePlanTrip(null, followInput.value.trim());
                        followInput.value = '';
                      }
                    }}
                    className="followup-form"
                  >
                    <input
                      type="text"
                      name="followupText"
                      className="followup-input"
                      placeholder="e.g. Can you adjust day 2 for outdoor activities only?"
                      disabled={loading}
                    />
                    <button type="submit" className="btn-primary" disabled={loading}>
                      Send
                    </button>
                  </form>
                </div>
              </div>

              {/* Right Column: Research Agent Results */}
              <aside className="results-sidebar-col">
                {/* Weather Table */}
                <div className="result-card">
                  <h3 className="card-title">
                    Destination Weather
                    <span className="card-subtitle">OpenWeatherMap</span>
                  </h3>
                  {weatherList.length > 0 ? (
                    <div className="data-table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Forecast</th>
                            <th>Min</th>
                            <th>Max</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weatherList.map((w, idx) => (
                            <tr key={idx}>
                              <td>{w.date}</td>
                              <td>{w.condition}</td>
                              <td>{w.minTemp}</td>
                              <td>{w.maxTemp}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="notice-line">No weather forecast records found.</p>
                  )}
                </div>

                {/* Flights Status */}
                <div className="result-card">
                  <h3 className="card-title">
                    Flight Status Records
                    <span className="card-subtitle">AviationStack</span>
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-faint)', marginBottom: '10px' }}>
                    Live flight status data. Not ticket prices.
                  </p>
                  {flightList.length > 0 ? (
                    <div className="flight-list">
                      {flightList.map((f, idx) => (
                        <div key={idx} className="flight-item">
                          <div className="flight-header">
                            <span>{f.airline} {f.flightNum}</span>
                            <span className="flight-status">{f.status}</span>
                          </div>
                          <div className="flight-meta">
                            {f.route && <div>Route: {f.route}</div>}
                            <div>Scheduled: {f.scheduled}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="notice-line">No live flight records found for route.</p>
                  )}
                </div>

                {/* Attractions List */}
                {attractionsList.length > 0 && (
                  <div className="result-card">
                    <h3 className="card-title">
                      Attractions
                      <span className="card-subtitle">OpenTripMap</span>
                    </h3>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {attractionsList.map((attr, idx) => (
                        <li
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '0.875rem',
                            borderBottom: '1px solid var(--color-border)',
                            paddingBottom: '4px',
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>{attr.name}</span>
                          {attr.rate !== undefined && (
                            <span style={{ color: 'var(--color-text-faint)', fontSize: '0.8rem' }}>
                              Rating: {attr.rate}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Price Estimate (Only if model_version is not stub-v0) */}
                {hasValidPricePrediction && (
                  <div className="result-card">
                    <h3 className="card-title">Estimated Route Fare</h3>
                    <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                      ${result.price_prediction.predicted_fare_usd}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-faint)', marginTop: '4px' }}>
                      Historical estimate, not a live fare.
                    </p>
                  </div>
                )}

                {/* Hotel Review Sentiment (Only if sample_size > 0 and real label) */}
                {hasValidSentiment && (
                  <div className="result-card">
                    <h3 className="card-title">Hotel Review Sentiment</h3>
                    <p style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                      Summary: {result.sentiment_summary.sentiment_label}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-faint)' }}>
                      Scored from {result.sentiment_summary.sample_size} search snippet(s).
                    </p>
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}
      </main>

      <Footer setView={setView} />
    </div>
  );
}

// Header Component
function Header({ user, setView }) {
  return (
    <header className="app-header">
      <div className="header-container">
        <a
          href="/"
          className="brand-link"
          onClick={(e) => {
            e.preventDefault();
            window.location.hash = '';
            setView('planner');
          }}
        >
          <div className="brand-monogram">W</div>
          <span className="brand-name">WanderWise AI</span>
        </a>

        <div className="user-profile">
          <div className="user-avatar-initials" title={user.name}>
            {getInitials(user.name)}
          </div>
          <span className="user-name">{user.firstName || user.name}</span>
          <a href="/logout" className="btn-signout">
            Sign Out
          </a>
        </div>
      </div>
    </header>
  );
}

// Footer Component
function Footer({ setView }) {
  return (
    <footer className="app-footer">
      <div className="footer-container">
        <div className="footer-disclaimer">
          WanderWise AI. Travel plans are AI-generated and must be verified before booking.
        </div>
        <div className="footer-links">
          <a
            href="#privacy"
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = '#privacy';
              setView('privacy');
            }}
          >
            Privacy Policy
          </a>
          <a
            href="#terms"
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = '#terms';
              setView('terms');
            }}
          >
            Terms and Conditions
          </a>
        </div>
      </div>
    </footer>
  );
}

// Mount React Root
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
