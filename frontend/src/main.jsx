import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  Plus, LogOut, Mic, Send, Save, Download, PencilLine, MapPin, Sun, Cloud, CloudSun,
  CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog, Plane, CalendarDays,
  ChevronDown, ChevronLeft, ChevronRight, Hotel, Star, ExternalLink, Menu, X, Copy,
  Trash2, Loader2, Landmark, Sparkles, ShieldCheck, FileText, Compass,
} from 'lucide-react';
import './style.css';

// Markdown setup
marked.setOptions({
  gfm: true,
  breaks: true,
});

const SAVED_TRIPS_KEY = 'wanderwise.savedTrips';
const MAX_SAVED_TRIPS = 12;

const SUGGESTIONS = [
  { label: '7 days in Japan on a budget', prompt: 'Plan 7 days in Japan on a budget, mixing Tokyo and Kyoto' },
  { label: 'Goa weekend getaway', prompt: 'Weekend getaway to Goa with beaches and seafood under ₹15,000' },
  { label: '5-day London with family', prompt: '5-day family trip to London with local food and historic sites' },
  { label: 'Solo trip to Kyoto', prompt: '3-day solo cultural trip to Kyoto with a moderate budget' },
  { label: 'Chicago architecture', prompt: 'Weekend trip to Chicago visiting architecture and art museums' },
];

const LOADING_STEPS = [
  'Checking live flight status…',
  'Searching hotels and reviews…',
  'Fetching the weather forecast…',
  'Finding top attractions…',
  'Writing your day-by-day plan…',
];

// Helper: Parse weather string
function parseWeatherData(weatherText) {
  if (!weatherText || typeof weatherText !== 'string') return { city: '', days: [] };
  const cityMatch = weatherText.match(/forecast for\s+(.+?):/i);
  const days = [];
  const regex = /[-*]\s*(\d{4}-\d{2}-\d{2}):\s*([^,]+),\s*(-?\d+)°C\s*to\s*(-?\d+)°C/i;
  for (const line of weatherText.split('\n')) {
    const match = line.match(regex);
    if (match) {
      days.push({
        date: match[1],
        condition: match[2].trim(),
        min: parseInt(match[3], 10),
        max: parseInt(match[4], 10),
      });
    }
  }
  return { city: cityMatch ? cityMatch[1].trim() : '', days };
}

// Helper: Parse flights string
function parseFlightData(flightText) {
  if (!flightText || typeof flightText !== 'string') return [];
  const flights = [];
  for (const block of flightText.split(/\n---\n/)) {
    const airlineMatch = block.match(/Airline:\s*(.+)/i);
    const flightMatch = block.match(/Flight:\s*(.+)/i);
    if (!airlineMatch && !flightMatch) continue;

    const statusMatch = block.match(/Status:\s*(.+)/i);
    const [depPart, arrPart = ''] = block.split(/\nArrival:/i);
    const depIata = depPart.match(/IATA:\s*(.+)/i);
    const depSched = depPart.match(/Scheduled:\s*(.+)/i);
    const arrIata = arrPart.match(/IATA:\s*(.+)/i);
    const arrSched = arrPart.match(/Scheduled:\s*(.+)/i);

    flights.push({
      airline: airlineMatch ? airlineMatch[1].trim() : 'Unknown Airline',
      flightNum: flightMatch ? flightMatch[1].trim() : '',
      status: statusMatch ? statusMatch[1].trim() : 'Scheduled',
      from: depIata ? depIata[1].trim() : '',
      to: arrIata ? arrIata[1].trim() : '',
      departs: splitTimestamp(depSched ? depSched[1].trim() : ''),
      arrives: splitTimestamp(arrSched ? arrSched[1].trim() : ''),
    });
  }
  return flights;
}

// "2026-10-11T17:00:00+00:00" -> { day: 'Sun, Oct 11', time: '17:00' } without timezone shifting
function splitTimestamp(value) {
  const match = value && value.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) return { day: '', time: value && value !== 'Unknown' ? value : '--' };
  return { day: formatDate(match[1], { weekday: 'short', month: 'short', day: 'numeric' }), time: match[2] };
}

// Helper: Parse Tavily hotel search results ("1. **Title**\n   url\n   snippet")
function parseHotelData(hotelText) {
  if (!hotelText || typeof hotelText !== 'string') return [];
  const hotels = [];
  for (const block of hotelText.split(/\n\s*\n(?=\s*\d+\.\s)/)) {
    const match = block.match(/^\s*\d+\.\s*\*\*(.+?)\*\*\s*\n\s*(\S+)\s*(?:\n([\s\S]*))?$/);
    if (!match) continue;
    let domain = '';
    try {
      domain = new URL(match[2]).hostname.replace(/^www\./, '');
    } catch {
      domain = '';
    }
    hotels.push({
      title: match[1].trim(),
      url: domain ? match[2] : '',
      domain,
      snippet: (match[3] || '').replace(/\s+/g, ' ').trim(),
    });
  }
  return hotels;
}

// Helper: Split the itinerary markdown into intro, per-day sections and outro
function splitItinerary(markdown) {
  const result = { intro: '', days: [], outro: '' };
  if (!markdown) return result;

  const isDay = (text) => /^\W*day\s*\d+/i.test(text.replace(/[*_#]/g, '').trim());
  const intro = [];
  const outro = [];
  let current = null;

  for (const line of markdown.split('\n')) {
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    const boldLine = line.match(/^\s*\*\*(.+?)\*\*:?\s*$/);
    const text = heading ? heading[2] : boldLine ? boldLine[1] : null;

    if (text && isDay(text)) {
      if (current) result.days.push(current);
      const clean = text.replace(/[*_#]/g, '').replace(/:\s*$/, '').trim();
      const parts = clean.match(/^\W*(day\s*\d+)\s*[:\-–—]?\s*(.*)$/i);
      current = {
        label: parts ? parts[1].replace(/^day\s*/i, 'Day ') : clean,
        subtitle: parts ? parts[2] : '',
        level: heading ? heading[1].length : 7,
        lines: [],
      };
      continue;
    }

    if (heading && current && heading[1].length <= current.level) {
      result.days.push(current);
      current = null;
    }

    if (current) current.lines.push(line);
    else if (result.days.length === 0) intro.push(line);
    else outro.push(line);
  }
  if (current) result.days.push(current);

  result.intro = intro.join('\n').trim();
  result.outro = outro.join('\n').trim();
  result.days = result.days.map((d) => ({ ...d, body: d.lines.join('\n').trim() }));
  return result;
}

function renderMarkdown(md) {
  return md ? DOMPurify.sanitize(marked.parse(md)) : '';
}

function formatDate(isoDate, options) {
  const date = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', options);
}

// Helper: Extract Initials
function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function loadSavedTrips() {
  try {
    const raw = window.localStorage.getItem(SAVED_TRIPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedTrips(trips) {
  try {
    window.localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(trips));
    return true;
  } catch {
    return false;
  }
}

function tripTitle(promptText, result) {
  const city = result ? parseWeatherData(result.weather_results).city : '';
  if (city) return `Trip to ${city}`;
  const text = (promptText || 'Saved trip').trim();
  return text.length > 34 ? text.slice(0, 32).trimEnd() + '…' : text;
}

function WeatherIcon({ condition, size = 20 }) {
  const c = (condition || '').toLowerCase();
  let Icon = CloudSun;
  let tone = 'sun';
  if (c.includes('clear')) Icon = Sun;
  else if (c.includes('thunder')) { Icon = CloudLightning; tone = 'storm'; }
  else if (c.includes('drizzle')) { Icon = CloudDrizzle; tone = 'rain'; }
  else if (c.includes('rain')) { Icon = CloudRain; tone = 'rain'; }
  else if (c.includes('snow')) { Icon = CloudSnow; tone = 'snow'; }
  else if (/mist|fog|haze|smoke|dust|sand|ash/.test(c)) { Icon = CloudFog; tone = 'cloud'; }
  else if (c.includes('cloud')) { Icon = Cloud; tone = 'cloud'; }
  return <Icon size={size} className={`wx-icon wx-${tone}`} aria-hidden="true" />;
}

function Avatar({ user, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  if (user.picture && !failed) {
    return (
      <img
        src={user.picture}
        alt=""
        className={`avatar avatar-${size}`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={`avatar avatar-${size} avatar-initials`} aria-hidden="true">
      {getInitials(user.name)}
    </div>
  );
}

// Privacy Policy Component
function PrivacyPage({ onBack }) {
  return (
    <div className="legal-page" id="privacy-page">
      {/* Draft, needs legal review before launch */}
      <button onClick={onBack} className="btn btn-ghost legal-back">
        <ChevronLeft size={16} /> Back to Planner
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
          Trips you save with the Save button are kept only in this browser's local storage.
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
  );
}

// Terms Component
function TermsPage({ onBack }) {
  return (
    <div className="legal-page" id="terms-page">
      {/* Draft, needs legal review before launch */}
      <button onClick={onBack} className="btn btn-ghost legal-back">
        <ChevronLeft size={16} /> Back to Planner
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
  );
}

// Sidebar Component (profile, new trip, saved trips, logout)
function Sidebar({ user, open, onClose, onNewTrip, savedTrips, activeTripId, onOpenTrip, onDeleteTrip, setView }) {
  const goLegal = (page) => (e) => {
    e.preventDefault();
    window.location.hash = '#' + page;
    setView(page);
    onClose();
  };

  return (
    <>
      <div className={`sidebar-scrim ${open ? 'show' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Trips and account">
        <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close menu">
          <X size={18} />
        </button>

        <div className="sidebar-profile">
          <Avatar user={user} size="lg" />
          <div className="sidebar-name">{user.name}</div>
          {user.email && <div className="sidebar-email" title={user.email}>{user.email}</div>}
          <span className="pill pill-soft">Traveler</span>
        </div>

        <button type="button" className="btn btn-primary btn-block" onClick={onNewTrip}>
          <Plus size={18} /> New Trip
        </button>

        <nav className="saved-trips" aria-labelledby="saved-trips-heading">
          <h2 id="saved-trips-heading" className="sidebar-heading">My Saved Trips</h2>
          {savedTrips.length === 0 ? (
            <p className="sidebar-empty">Trips you save will appear here.</p>
          ) : (
            <ul>
              {savedTrips.map((trip, idx) => (
                <li key={trip.id}>
                  <button
                    type="button"
                    className={`saved-trip ${trip.id === activeTripId ? 'active' : ''}`}
                    onClick={() => onOpenTrip(trip)}
                    title={trip.prompt}
                  >
                    <span className={`trip-thumb tone-${idx % 4}`} aria-hidden="true">
                      <MapPin size={14} />
                    </span>
                    <span className="saved-trip-title">{trip.title}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn saved-trip-delete"
                    onClick={() => onDeleteTrip(trip.id)}
                    aria-label={`Delete ${trip.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="sidebar-footer">
          <a href="#privacy" className="sidebar-link" onClick={goLegal('privacy')}>
            <ShieldCheck size={17} /> Privacy Policy
          </a>
          <a href="#terms" className="sidebar-link" onClick={goLegal('terms')}>
            <FileText size={17} /> Terms
          </a>
          <a href="/logout" className="sidebar-link">
            <LogOut size={17} /> Logout
          </a>
        </div>
      </aside>
    </>
  );
}

// Decorative travel illustration for the empty chat state
function TravelIllustration() {
  return (
    <svg className="travel-illustration" viewBox="0 0 520 220" role="img" aria-label="Travelers in front of world landmarks">
      <defs>
        <linearGradient id="skyFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--illu-far)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--illu-far)" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      {/* Plane */}
      <path d="M392 38 l34 -10 l6 3 l-22 12 l10 9 l-5 2 l-13 -6 l-14 6 l-4 -2 l10 -9 z" fill="var(--illu-near)" />
      <path d="M300 60 q50 -30 88 -20" stroke="var(--illu-far)" strokeWidth="2" fill="none" strokeDasharray="4 6" />
      {/* Statue of Liberty */}
      <g fill="url(#skyFade)">
        <rect x="70" y="120" width="34" height="80" />
        <rect x="80" y="70" width="14" height="52" />
        <rect x="84" y="40" width="4" height="34" />
        <circle cx="86" cy="62" r="9" />
        <path d="M78 54 l8 -8 l8 8 z" />
      </g>
      {/* Classical building */}
      <g fill="var(--illu-mid)">
        <path d="M120 150 l60 -28 l60 28 z" />
        <rect x="124" y="150" width="112" height="8" />
        {[132, 152, 172, 192, 212].map((x) => <rect key={x} x={x} y="160" width="10" height="34" />)}
        <rect x="118" y="194" width="124" height="8" />
      </g>
      {/* Eiffel tower */}
      <g fill="var(--illu-far)" opacity="0.6">
        <path d="M386 202 l18 -70 l4 -60 l4 60 l18 70 h-10 l-12 -40 l-12 40 z" />
        <rect x="396" y="128" width="24" height="5" />
        <rect x="402" y="96" width="12" height="4" />
      </g>
      {/* Travelers */}
      <g fill="var(--illu-near)">
        <circle cx="282" cy="96" r="10" />
        <path d="M270 110 h24 l4 50 h-8 l-2 42 h-8 l-2 -36 l-2 36 h-8 l-2 -42 h-8 z" />
        <rect x="300" y="150" width="22" height="34" rx="3" />
        <rect x="308" y="142" width="6" height="8" />
        <circle cx="342" cy="124" r="7" />
        <path d="M334 134 h16 l3 30 h-5 l-1 38 h-5 l-1 -28 l-1 28 h-5 l-1 -38 h-5 z" />
        <circle cx="236" cy="104" r="9" />
        <path d="M226 116 h20 l4 46 h-7 l-2 40 h-7 l-1 -32 l-1 32 h-7 l-2 -40 h-7 z" />
        <rect x="204" y="156" width="18" height="28" rx="3" />
      </g>
      <rect x="40" y="202" width="440" height="3" rx="1.5" fill="var(--illu-far)" opacity="0.5" />
    </svg>
  );
}

// Temperature line chart for the forecast days
function TempChart({ days, selected, onSelect }) {
  const W = 640;
  const H = 150;
  const padX = 36;
  const padTop = 30;
  const padBottom = 30;
  const n = days.length;
  const temps = days.flatMap((d) => [d.min, d.max]);
  const hi = Math.max(...temps) + 2;
  const lo = Math.min(...temps) - 2;
  const x = (i) => (n === 1 ? W / 2 : padX + (i * (W - 2 * padX)) / (n - 1));
  const y = (t) => padTop + ((hi - t) / (hi - lo || 1)) * (H - padTop - padBottom);

  const smooth = (key) => days.reduce((path, d, i) => {
    if (i === 0) return `M ${x(0)} ${y(d[key])}`;
    const px = x(i - 1);
    const py = y(days[i - 1][key]);
    const cx = (px + x(i)) / 2;
    return `${path} C ${cx} ${py}, ${cx} ${y(d[key])}, ${x(i)} ${y(d[key])}`;
  }, '');

  const maxPath = smooth('max');
  const minPath = smooth('min');
  const area = `${maxPath} L ${x(n - 1)} ${H - padBottom} L ${x(0)} ${H - padBottom} Z`;

  return (
    <svg className="temp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily high and low temperatures">
      <defs>
        <linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-warm)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--color-warm)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#tempFill)" />
      <path d={minPath} fill="none" stroke="var(--color-primary-300)" strokeWidth="2" strokeDasharray="5 5" />
      <path d={maxPath} fill="none" stroke="var(--color-warm)" strokeWidth="2.5" />
      {days.map((d, i) => (
        <g key={d.date} className="temp-point" onClick={() => onSelect(i)}>
          <rect x={x(i) - 24} y="0" width="48" height={H} fill="transparent" />
          {i === selected && (
            <line x1={x(i)} x2={x(i)} y1={padTop - 6} y2={H - padBottom} stroke="var(--color-primary-300)" strokeDasharray="3 4" />
          )}
          <circle cx={x(i)} cy={y(d.max)} r={i === selected ? 5 : 3.5} fill="var(--color-surface)" stroke="var(--color-warm)" strokeWidth="2.5" />
          <text x={x(i)} y={y(d.max) - 11} textAnchor="middle" className="temp-label">{d.max}°</text>
          <text x={x(i)} y={H - 8} textAnchor="middle" className="temp-axis">
            {formatDate(d.date, { weekday: 'short' })}
          </text>
        </g>
      ))}
    </svg>
  );
}

function WeatherCard({ weather }) {
  const [selected, setSelected] = useState(0);
  const stripRef = useRef(null);
  const day = weather.days[selected];

  const scrollStrip = (dir) => {
    if (stripRef.current) stripRef.current.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };

  return (
    <section className="card weather-card" aria-labelledby="weather-title">
      <div className="weather-top">
        <div>
          <div className="weather-location">
            <MapPin size={15} /> {weather.city || 'Destination'}
          </div>
          <div className="weather-now">
            <WeatherIcon condition={day.condition} size={44} />
            <span className="weather-temp">{day.max}</span>
            <span className="weather-unit">°C</span>
            <div className="weather-range">
              <span>High {day.max}°</span>
              <span>Low {day.min}°</span>
            </div>
          </div>
        </div>
        <div className="weather-summary">
          <h3 id="weather-title" className="card-title">Weather</h3>
          <div>{formatDate(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          <div className="muted">{day.condition}</div>
        </div>
      </div>

      <TempChart days={weather.days} selected={selected} onSelect={setSelected} />

      <div className="day-strip-wrap">
        <div className="day-strip" ref={stripRef} role="tablist" aria-label="Forecast days">
          {weather.days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={i === selected}
              className={`day-pill ${i === selected ? 'active' : ''}`}
              onClick={() => setSelected(i)}
            >
              <span className="day-pill-name">{formatDate(d.date, { weekday: 'short' })}</span>
              <WeatherIcon condition={d.condition} size={24} />
              <span className="day-pill-temps">
                <strong>{d.max}°</strong> {d.min}°
              </span>
            </button>
          ))}
        </div>
        {weather.days.length > 4 && (
          <div className="strip-arrows">
            <button type="button" className="icon-btn round" onClick={() => scrollStrip(-1)} aria-label="Scroll days left">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="icon-btn round" onClick={() => scrollStrip(1)} aria-label="Scroll days right">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      <p className="source-note">Daily highs and lows from OpenWeatherMap</p>
    </section>
  );
}

function FlightCard({ flights }) {
  return (
    <section className="card" aria-labelledby="flights-title">
      <div className="card-head">
        <h3 id="flights-title" className="card-title">Flight Information</h3>
        <span className="card-icons" aria-hidden="true"><Plane size={17} /><CalendarDays size={17} /></span>
      </div>
      <p className="source-note">Live flight status from AviationStack. Not ticket prices.</p>
      {flights.length > 0 ? (
        <div className="table-scroll">
          <table className="flight-table">
            <thead>
              <tr>
                <th>Flight</th>
                <th>Departs</th>
                <th>Route</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f, idx) => (
                <tr key={idx}>
                  <td>
                    <div className="strong">{f.airline}</div>
                    <div className="muted small">{f.flightNum}</div>
                  </td>
                  <td>
                    <div className="strong">{f.departs.time}</div>
                    <div className="muted small">{f.departs.day}</div>
                  </td>
                  <td className="route-cell">
                    {f.from || '—'} <Plane size={12} aria-hidden="true" /> {f.to || '—'}
                  </td>
                  <td>
                    <span className={`badge status-${f.status.toLowerCase().replace(/\s+/g, '-')}`}>{f.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-line">No live flight records found for this route.</p>
      )}
    </section>
  );
}

function HotelCard({ hotels, sentiment }) {
  return (
    <section className="card" aria-labelledby="hotels-title">
      <div className="card-head">
        <h3 id="hotels-title" className="card-title">Hotel Suggestions</h3>
        {sentiment && (
          <span className="badge badge-success" title={`Scored from ${sentiment.sample_size} search snippet(s)`}>
            Reviews: {sentiment.sentiment_label}
          </span>
        )}
      </div>
      {hotels.length > 0 ? (
        <ul className="hotel-list">
          {hotels.map((h, idx) => (
            <li key={idx} className="hotel-item">
              <span className="hotel-icon" aria-hidden="true"><Hotel size={18} /></span>
              <div className="hotel-body">
                <div className="hotel-title">{h.title}</div>
                {h.snippet && <p className="hotel-snippet">{h.snippet}</p>}
              </div>
              {h.url && (
                <a className="btn btn-soft btn-sm" href={h.url} target="_blank" rel="noopener noreferrer">
                  View <ExternalLink size={13} />
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">No hotel suggestions returned.</p>
      )}
      <p className="source-note">Web results from Tavily Search. Check prices with the provider.</p>
    </section>
  );
}

function ItineraryTimeline({ markdown }) {
  const parts = splitItinerary(markdown);
  const [openDays, setOpenDays] = useState(() => new Set([0]));

  const toggle = (idx) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (parts.days.length === 0) {
    const html = renderMarkdown(markdown);
    return html
      ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      : <p className="empty-line">No itinerary text returned.</p>;
  }

  return (
    <>
      {parts.intro && (
        <div className="markdown-body itinerary-intro" dangerouslySetInnerHTML={{ __html: renderMarkdown(parts.intro) }} />
      )}
      <ol className="timeline">
        {parts.days.map((d, idx) => {
          const isOpen = openDays.has(idx);
          return (
            <li key={idx} className={`timeline-day ${isOpen ? 'open' : ''}`}>
              <span className="timeline-dot" aria-hidden="true" />
              <button
                type="button"
                className="timeline-toggle"
                aria-expanded={isOpen}
                onClick={() => toggle(idx)}
              >
                <span className="timeline-label">{d.label}</span>
                {d.subtitle && <span className="timeline-subtitle">{d.subtitle}</span>}
                <ChevronDown size={18} className="timeline-chevron" aria-hidden="true" />
              </button>
              <div className="timeline-body">
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(d.body) }} />
              </div>
            </li>
          );
        })}
      </ol>
      {parts.outro && (
        <div className="markdown-body itinerary-outro" dangerouslySetInnerHTML={{ __html: renderMarkdown(parts.outro) }} />
      )}
    </>
  );
}

// Results screen: weather, flights, hotels, attractions and itinerary cards
function ResultsView({ result, user, tripPrompt, isSaved, onSave, onCopy, onPrint, onEditPrompt, onFollowUp, onOpenMenu, loading }) {
  const [followUp, setFollowUp] = useState('');
  const weather = parseWeatherData(result.weather_results);
  const flights = parseFlightData(result.flight_results);
  const hotels = parseHotelData(result.hotel_results);
  const attractions = Array.isArray(result.recommended_attractions) ? result.recommended_attractions : [];

  // Hide price prediction for the stub model or when absent
  const pricePrediction = result.price_prediction &&
    result.price_prediction.model_version &&
    result.price_prediction.model_version !== 'stub-v0' &&
    result.price_prediction.predicted_fare_usd
    ? result.price_prediction
    : null;

  // Hide sentiment when there is no real sample
  const sentiment = result.sentiment_summary &&
    result.sentiment_summary.sample_size > 0 &&
    result.sentiment_summary.sentiment_label
    ? result.sentiment_summary
    : null;

  const submitFollowUp = (e) => {
    e.preventDefault();
    if (!followUp.trim()) return;
    onFollowUp(followUp.trim());
    setFollowUp('');
  };

  return (
    <section className="results" aria-labelledby="results-title">
      <div className="results-bar">
        <button type="button" className="icon-btn menu-btn" onClick={onOpenMenu} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <div className="brand-mark" aria-hidden="true">W</div>
        <span className="bar-divider" aria-hidden="true" />
        <Avatar user={user} size="sm" />
        <div className="results-bar-title">
          <h1 id="results-title">{weather.city ? `Your trip to ${weather.city}` : 'Your travel plan'}</h1>
          {tripPrompt && <p title={tripPrompt}>{tripPrompt}</p>}
        </div>
        <div className="results-actions">
          <button type="button" className="btn btn-soft" onClick={onSave} disabled={isSaved}>
            <Save size={16} /> {isSaved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className="btn btn-soft" onClick={onCopy}>
            <Copy size={16} /> <span className="hide-sm">Copy</span>
          </button>
          <button type="button" className="btn btn-soft" onClick={onPrint}>
            <Download size={16} /> <span className="hide-sm">Download PDF</span>
          </button>
          <button type="button" className="btn btn-soft" onClick={onEditPrompt}>
            <PencilLine size={16} /> <span className="hide-sm">Edit Prompt</span>
          </button>
        </div>
      </div>

      <div className="results-grid">
        <div className="results-col">
          {weather.days.length > 0 ? (
            <WeatherCard weather={weather} />
          ) : (
            <section className="card">
              <h3 className="card-title">Weather</h3>
              <p className="empty-line">No weather forecast records found.</p>
            </section>
          )}

          <section className="card" aria-labelledby="itinerary-title">
            <div className="card-head">
              <h3 id="itinerary-title" className="card-title">Day-by-Day Itinerary</h3>
              <span className="badge"><Sparkles size={12} /> AI generated</span>
            </div>
            <ItineraryTimeline markdown={result.answer || result.itinerary || ''} />
            <p className="disclaimer">
              AI-generated plan. Verify flight times and booking details with official operators.
            </p>
          </section>
        </div>

        <div className="results-col">
          <FlightCard flights={flights} />
          <HotelCard hotels={hotels} sentiment={sentiment} />

          {attractions.length > 0 && (
            <section className="card" aria-labelledby="attractions-title">
              <div className="card-head">
                <h3 id="attractions-title" className="card-title">Top Attractions</h3>
                <span className="card-icons" aria-hidden="true"><Landmark size={17} /></span>
              </div>
              <ul className="attraction-list">
                {attractions.map((a, idx) => (
                  <li key={idx}>
                    <span className="attraction-name">{a.name}</span>
                    {a.rate !== undefined && a.rate !== null && (
                      <span className="stars" aria-label={`Rating ${a.rate}`}>
                        {Array.from({ length: Math.max(1, Math.min(7, Math.round(Number(a.rate)) || 0)) }).map((_, s) => (
                          <Star key={s} size={13} aria-hidden="true" />
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="source-note">Points of interest from OpenTripMap</p>
            </section>
          )}

          {pricePrediction && (
            <section className="card fare-card">
              <h3 className="card-title">Estimated Route Fare</h3>
              <div className="fare-value">${pricePrediction.predicted_fare_usd}</div>
              <p className="source-note">Historical estimate, not a live fare.</p>
            </section>
          )}

          <section className="card followup-card no-print">
            <h3 className="card-title">Refine this plan</h3>
            <p className="muted small">Ask a follow-up. Your conversation context is kept.</p>
            <form onSubmit={submitFollowUp} className="followup-form">
              <input
                type="text"
                className="input"
                placeholder="e.g. Make day 2 outdoor activities only"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                disabled={loading}
                aria-label="Follow-up question"
              />
              <button type="submit" className="btn btn-primary icon-only" disabled={loading || !followUp.trim()} aria-label="Send follow-up">
                <Send size={17} />
              </button>
            </form>
          </section>
        </div>
      </div>
    </section>
  );
}

// Chat screen: greeting, illustration / loading, suggestions and composer
function ChatView({ user, prompt, setPrompt, loading, loadingStep, error, pendingPrompt, onSubmit, onCancel, onRetry, onOpenMenu, onBackToResults }) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => () => {
    if (recognitionRef.current) recognitionRef.current.abort();
  }, []);

  const toggleVoice = () => {
    if (!SpeechRecognition) return;
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((r) => r[0].transcript).join(' ');
      setPrompt((prev) => (prev ? prev.trimEnd() + ' ' : '') + transcript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <section className="chat" aria-labelledby="chat-heading">
      <div className="chat-top">
        <button type="button" className="icon-btn menu-btn" onClick={onOpenMenu} aria-label="Open menu">
          <Menu size={20} />
        </button>
        {onBackToResults && (
          <button type="button" className="btn btn-ghost" onClick={onBackToResults}>
            <ChevronLeft size={16} /> Back to plan
          </button>
        )}
      </div>

      <div className="chat-hero">
        <h1 id="chat-heading" className="chat-greeting">
          Hey {user.firstName || user.name}, where's your next adventure? <span aria-hidden="true">✈️</span>
        </h1>

        {loading ? (
          <div className="loading-card" aria-live="polite">
            {pendingPrompt && <div className="user-bubble">{pendingPrompt}</div>}
            <div className="loading-row">
              <Loader2 size={22} className="spin" aria-hidden="true" />
              <div>
                <div className="loading-title">Planning your trip</div>
                <div className="loading-step">{loadingStep}</div>
              </div>
            </div>
            <div className="loading-bar"><span /></div>
            <p className="muted small">Our agents are researching flights, hotels, weather and attractions. This usually takes 15 to 30 seconds.</p>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          </div>
        ) : (
          <TravelIllustration />
        )}

        {error && !loading && (
          <div className="alert alert-error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-soft btn-sm" onClick={onRetry}>Retry</button>
          </div>
        )}
      </div>

      <div className="chat-bottom">
        <div className="chips" aria-label="Suggestions">
          {SUGGESTIONS.map((s, idx) => (
            <button
              key={s.label}
              type="button"
              className={`chip tone-${idx % 4}`}
              onClick={() => setPrompt(s.prompt)}
              disabled={loading}
            >
              {s.label}
            </button>
          ))}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <label htmlFor="trip-query" className="sr-only">Describe your trip</label>
          <textarea
            id="trip-query"
            className="composer-input"
            placeholder="Plan a trip from Nagpur to Goa under ₹5000…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            rows={3}
          />
          <div className="composer-actions">
            <div className="composer-tools">
              {SpeechRecognition && (
                <button
                  type="button"
                  className={`icon-btn ${listening ? 'recording' : ''}`}
                  onClick={toggleVoice}
                  disabled={loading}
                  aria-label={listening ? 'Stop voice input' : 'Start voice input'}
                  aria-pressed={listening}
                >
                  <Mic size={18} />
                </button>
              )}
              <span className="composer-hint">Enter to send · Shift+Enter for a new line</span>
            </div>
            <button
              type="submit"
              className="send-btn"
              disabled={loading || !prompt.trim()}
              aria-label="Generate plan"
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

// Main App Component
function App() {
  const [view, setView] = useState('planner'); // 'planner', 'privacy', 'terms'
  const [screen, setScreen] = useState('chat'); // 'chat', 'results'
  const [prompt, setPrompt] = useState('');
  const [tripPrompt, setTripPrompt] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [error, setError] = useState(null);
  const [lastQuery, setLastQuery] = useState('');
  const [result, setResult] = useState(null);
  const [threadId, setThreadId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedTrips, setSavedTrips] = useState(loadSavedTrips);
  const [activeTripId, setActiveTripId] = useState(null);
  const abortControllerRef = useRef(null);
  const notifyTimerRef = useRef(null);

  const user = window.USER_DATA || { name: 'Traveler', picture: '', firstName: 'Traveler', email: '' };

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

  // Cycle the indicative loading messages while the agents run
  useEffect(() => {
    if (!loading) return undefined;
    setLoadingStepIdx(0);
    const timer = setInterval(() => {
      setLoadingStepIdx((i) => Math.min(i + 1, LOADING_STEPS.length - 1));
    }, 5000);
    return () => clearInterval(timer);
  }, [loading]);

  const showNotification = (msg, type = 'info') => {
    setNotification({ msg, type });
    clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(() => setNotification(null), 4000);
  };

  const handlePlanTrip = async (customMessage = null) => {
    const queryText = (customMessage || prompt).trim();
    if (!queryText || loading) return;

    setError(null);
    setLastQuery(queryText);
    setPendingPrompt(queryText);
    setScreen('chat');
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/travel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: queryText,
          thread_id: threadId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Server returned an error status: ' + response.status);
      }

      const data = await response.json();
      setResult(data);
      setTripPrompt(queryText);
      setActiveTripId(null);
      setPrompt('');
      if (data.thread_id) {
        setThreadId(data.thread_id);
      }
      setScreen('results');
      window.scrollTo({ top: 0 });
      showNotification('Travel plan generated successfully.', 'success');
    } catch (err) {
      if (err.name === 'AbortError') {
        showNotification('Request canceled.', 'info');
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

  const handleNewTrip = () => {
    handleCancel();
    setResult(null);
    setThreadId(null);
    setPrompt('');
    setTripPrompt('');
    setError(null);
    setActiveTripId(null);
    setScreen('chat');
    setMenuOpen(false);
    if (view !== 'planner') {
      window.location.hash = '';
      setView('planner');
    }
  };

  const handleSave = () => {
    if (!result) return;
    const trip = {
      id: String(Date.now()),
      title: tripTitle(tripPrompt, result),
      prompt: tripPrompt,
      threadId,
      savedAt: new Date().toISOString(),
      result,
    };
    const next = [trip, ...savedTrips].slice(0, MAX_SAVED_TRIPS);
    if (persistSavedTrips(next)) {
      setSavedTrips(next);
      setActiveTripId(trip.id);
      showNotification('Trip saved to this browser.', 'success');
    } else {
      showNotification('Could not save the trip. Browser storage is unavailable or full.', 'error');
    }
  };

  const handleOpenTrip = (trip) => {
    handleCancel();
    setResult(trip.result);
    setTripPrompt(trip.prompt);
    setThreadId(trip.threadId || null);
    setActiveTripId(trip.id);
    setError(null);
    setScreen('results');
    setMenuOpen(false);
    if (view !== 'planner') {
      window.location.hash = '';
      setView('planner');
    }
  };

  const handleDeleteTrip = (id) => {
    const next = savedTrips.filter((t) => t.id !== id);
    persistSavedTrips(next);
    setSavedTrips(next);
    if (activeTripId === id) setActiveTripId(null);
  };

  const handleCopy = () => {
    if (!result) return;
    const textToCopy = result.answer || result.itinerary || '';
    if (!textToCopy) {
      showNotification('No text available to copy.', 'error');
      return;
    }
    navigator.clipboard.writeText(textToCopy)
      .then(() => showNotification('Trip plan copied to clipboard.', 'success'))
      .catch(() => showNotification('Failed to copy to clipboard.', 'error'));
  };

  const handlePrint = () => {
    window.print();
  };

  const backToPlanner = () => {
    window.location.hash = '';
    setView('planner');
  };

  let content;
  if (view === 'privacy') {
    content = <PrivacyPage onBack={backToPlanner} />;
  } else if (view === 'terms') {
    content = <TermsPage onBack={backToPlanner} />;
  } else if (screen === 'results' && result) {
    content = (
      <ResultsView
        result={result}
        user={user}
        tripPrompt={tripPrompt}
        isSaved={Boolean(activeTripId)}
        onSave={handleSave}
        onCopy={handleCopy}
        onPrint={handlePrint}
        onEditPrompt={() => {
          setPrompt(tripPrompt);
          setScreen('chat');
        }}
        onFollowUp={(text) => handlePlanTrip(text)}
        onOpenMenu={() => setMenuOpen(true)}
        loading={loading}
      />
    );
  } else {
    content = (
      <ChatView
        user={user}
        prompt={prompt}
        setPrompt={setPrompt}
        loading={loading}
        loadingStep={LOADING_STEPS[loadingStepIdx]}
        error={error}
        pendingPrompt={pendingPrompt}
        onSubmit={() => handlePlanTrip()}
        onCancel={handleCancel}
        onRetry={() => handlePlanTrip(lastQuery)}
        onOpenMenu={() => setMenuOpen(true)}
        onBackToResults={result && !loading ? () => setScreen('results') : null}
      />
    );
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <Sidebar
        user={user}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNewTrip={handleNewTrip}
        savedTrips={savedTrips}
        activeTripId={activeTripId}
        onOpenTrip={handleOpenTrip}
        onDeleteTrip={handleDeleteTrip}
        setView={setView}
      />

      <main className="main-panel" id="main-content">
        {content}
        <footer className="app-footer no-print">
          <Compass size={14} aria-hidden="true" />
          WanderWise AI. Travel plans are AI-generated and must be verified before booking.
        </footer>
      </main>

      {notification && (
        <div className={`toast toast-${notification.type}`} role="status">
          <span>{notification.msg}</span>
          <button type="button" className="icon-btn" onClick={() => setNotification(null)} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// Mount React Root
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
}
