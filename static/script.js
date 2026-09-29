const { useState, useEffect, useRef } = React;

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function parseWeather(weatherString) {
    if (!weatherString) return null;
    const lines = weatherString.split('\n');
    const dates = [], minTemps = [], maxTemps = [], conditions = [];
    const regex = /- (\d{4}-\d{2}-\d{2}): (.*?), (-?\d+)°C to (-?\d+)°C/;
    for (const line of lines) {
        const match = line.match(regex);
        if (match) {
            dates.push(match[1]);
            conditions.push(match[2]);
            minTemps.push(parseInt(match[3], 10));
            maxTemps.push(parseInt(match[4], 10));
        }
    }
    return dates.length > 0 ? { dates, conditions, minTemps, maxTemps } : null;
}

function getDayName(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', { weekday: 'short' });
}

function getWeatherEmoji(condition) {
    const lower = (condition || '').toLowerCase();
    if (lower.includes('rain')) return '🌧️';
    if (lower.includes('cloud')) return '☁️';
    if (lower.includes('clear') || lower.includes('sunny')) return '☀️';
    if (lower.includes('snow')) return '❄️';
    if (lower.includes('storm') || lower.includes('thunder')) return '⛈️';
    return '⛅';
}

function copyToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text)
        .then(() => alert("Travel Plan copied to clipboard!"))
        .catch(() => alert("Could not copy result."));
}

function downloadPDF() {
    const pdfContent = document.getElementById("pdfContent");
    if (!pdfContent) return;
    html2pdf().set({
        margin: 0.5, filename: "ai-travel-plan.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#F8FAFC" },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" }
    }).from(pdfContent).save();
}

// Split AI markdown into keyed sections
function splitMarkdownSections(markdown) {
    if (!markdown) return {};
    const sections = {};
    const parts = markdown.split(/\n## /);
    if (parts[0].trim()) sections['intro'] = parts[0].trim();
    for (let i = 1; i < parts.length; i++) {
        const lines = parts[i].split('\n');
        const title = lines.shift().trim().toLowerCase();
        const content = lines.join('\n').trim();
        sections[title] = content;
    }
    return sections;
}

// Parse flights from markdown/flight_results string
function parseFlights(flightString) {
    if (!flightString) return [];
    const flights = [];
    const blocks = flightString.split(/\n---\n/);
    for (const block of blocks) {
        const airline = (block.match(/Airline:\s*(.+)/) || [])[1];
        const flightNum = (block.match(/Flight:\s*(.+)/) || [])[1];
        const status = (block.match(/Status:\s*(.+)/) || [])[1];
        const depScheduled = (block.match(/Scheduled:\s*(.+)/) || [])[1];
        const depIata = (block.match(/IATA:\s*(.+)/) || [])[1];
        if (airline || flightNum) {
            flights.push({ airline, flightNum, status, time: depScheduled, from: depIata });
        }
    }
    return flights.slice(0, 5);
}

// Parse hotels from a text block  
function parseHotels(hotelText) {
    if (!hotelText) return [];
    const lines = hotelText.split('\n').filter(l => l.trim());
    const hotels = [];
    let current = null;
    for (const line of lines) {
        const priceMatch = line.match(/\*\*(.*?)\*\*.*?[₹$](\d+)/);
        const nameMatch = line.match(/^[-*•]\s*\*\*(.*?)\*\*/);
        if (priceMatch) {
            if (current) hotels.push(current);
            current = { name: priceMatch[1].trim(), price: priceMatch[2], amenities: [], stars: 4 };
        } else if (nameMatch && !current) {
            if (current) hotels.push(current);
            current = { name: nameMatch[1].trim(), price: null, amenities: [], stars: 4 };
        } else if (current && line.trim().startsWith('-')) {
            current.amenities.push(line.replace(/^[-•*]\s*/, '').trim());
        }
    }
    if (current) hotels.push(current);
    return hotels.slice(0, 4);
}

// Parse day-by-day itinerary
function parseDays(markdown) {
    if (!markdown) return [];
    const days = [];
    const dayRegex = /\*?\*?(?:Day\s+(\d+)|(\d+)\.\s*Day).*?\*?\*?/gi;
    const parts = markdown.split(/\n### /);
    for (let i = 1; i < parts.length; i++) {
        const lines = parts[i].split('\n');
        const title = lines.shift().trim();
        const content = lines.join('\n').trim();
        if (/day\s*\d+/i.test(title)) {
            days.push({ title, content });
        }
    }
    if (days.length === 0) {
        const p2 = markdown.split(/\n\*\*Day /);
        for (let i = 1; i < p2.length; i++) {
            const lines = p2[i].split('\n');
            const title = 'Day ' + lines.shift().replace(/\*+/g, '').trim();
            const content = lines.join('\n').trim();
            days.push({ title, content });
        }
    }
    return days;
}

// Star Rating Component
function StarRating({ count }) {
    return (
        <span className="flex gap-0.5">
            {[1,2,3,4,5].map(i => (
                <svg key={i} className={`w-4 h-4 ${i <= count ? 'text-amber-400' : 'text-slate-200'}`} fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
            ))}
        </span>
    );
}

// ============================================================
// WEATHER WIDGET
// ============================================================

function WeatherWidget({ weatherResults, destCity, destCountry }) {
    const canvasRef = useRef(null);
    const chartRef = useRef(null);
    const [selectedDay, setSelectedDay] = useState(0);
    const weatherData = parseWeather(weatherResults);

    useEffect(() => {
        if (!weatherData || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (chartRef.current) chartRef.current.destroy();

        let gradient = ctx.createLinearGradient(0, 0, 0, 120);
        gradient.addColorStop(0, 'rgba(250, 200, 100, 0.5)');
        gradient.addColorStop(1, 'rgba(250, 200, 100, 0.0)');

        const timeLabels = ['1 pm','4 pm','7 pm','10 pm','1 am','4 am','7 am','10 am'];
        const tempData = weatherData.maxTemps.concat(weatherData.minTemps).slice(0, 8);

        chartRef.current = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timeLabels,
                datasets: [{
                    data: tempData,
                    borderColor: '#EAB308',
                    backgroundColor: gradient,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.45,
                    pointBackgroundColor: '#FFFFFF',
                    pointBorderColor: '#EAB308',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.raw + '°C' } } },
                scales: {
                    x: { 
                        display: true,
                        ticks: { color: '#94A3B8', font: { size: 10 } },
                        grid: { display: false },
                        border: { display: false }
                    },
                    y: { 
                        display: true,
                        ticks: { color: '#94A3B8', font: { size: 10 }, callback: v => v + '°' },
                        grid: { color: 'rgba(241,245,249,0.8)' },
                        border: { display: false },
                        min: Math.min(...weatherData.minTemps) - 3,
                        max: Math.max(...weatherData.maxTemps) + 3
                    }
                },
                layout: { padding: { top: 8, bottom: 0, left: 4, right: 8 } }
            }
        });
        return () => { if (chartRef.current) chartRef.current.destroy(); };
    }, [weatherResults]);

    if (!weatherData) return null;
    const today = weatherData.maxTemps[0];
    const condition = weatherData.conditions[0] || 'Partly Cloudy';

    return (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            {/* Top weather summary row */}
            <div className="p-5 border-b border-slate-100">
                <div className="flex items-start justify-between">
                    <div className="flex-1">
                        <div className="flex items-center gap-1.5 text-slate-500 text-sm font-medium mb-2">
                            <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                            </svg>
                            <span className="font-semibold text-slate-700">{destCity || 'Destination'}{destCountry ? ', ' + destCountry : ''}</span>
                        </div>
                        <div className="flex items-end gap-3">
                            <span className="text-5xl font-bold text-slate-800 leading-none">{today}</span>
                            <div className="mb-1">
                                <span className="text-2xl text-slate-400 font-light">°C</span>
                                <div className="text-sm text-slate-500 font-medium">{getWeatherEmoji(condition)} {condition}</div>
                            </div>
                        </div>
                    </div>
                    <div className="text-right text-sm">
                        <div className="font-semibold text-slate-700 text-base mb-1">Weather</div>
                        <div className="text-slate-400 text-xs">{new Date().toLocaleDateString('en-US', { weekday:'long', hour:'2-digit', minute:'2-digit' })}</div>
                        <div className="mt-2 space-y-1">
                            <div className="text-xs text-slate-500"><span className="font-medium text-slate-600">Precipitation:</span> 0%</div>
                            <div className="text-xs text-slate-500"><span className="font-medium text-slate-600">Humidity:</span> ~55%</div>
                            <div className="text-xs text-slate-500"><span className="font-medium text-slate-600">Wind:</span> 8 km/h</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className="px-4 pt-3 pb-2 bg-slate-50/50" style={{height: '130px'}}>
                <canvas ref={canvasRef} style={{height: '100%'}}></canvas>
            </div>

            {/* Day strip */}
            <div className="flex border-t border-slate-100 divide-x divide-slate-100 overflow-x-auto">
                {weatherData.dates.slice(0, 7).map((date, i) => (
                    <button
                        key={date}
                        onClick={() => setSelectedDay(i)}
                        className={`flex flex-col items-center px-3 py-3 min-w-[60px] flex-1 transition-colors ${selectedDay === i ? 'bg-primary text-white' : 'hover:bg-slate-50 text-slate-600'}`}
                    >
                        <span className={`text-xs font-semibold mb-1 ${selectedDay === i ? 'text-blue-100' : 'text-slate-500'}`}>{getDayName(date)}</span>
                        <span className="text-lg mb-1">{getWeatherEmoji(weatherData.conditions[i])}</span>
                        <div className={`text-xs font-bold ${selectedDay === i ? 'text-white' : 'text-slate-700'}`}>
                            {weatherData.maxTemps[i]}°
                            <span className={`font-normal ml-0.5 ${selectedDay === i ? 'text-blue-200' : 'text-slate-400'}`}>{weatherData.minTemps[i]}°</span>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ============================================================
// FLIGHT CARD
// ============================================================

function FlightCard({ flightResults, answer }) {
    const flights = parseFlights(flightResults);
    
    // Also try to extract from markdown if no structured data
    const sections = splitMarkdownSections(answer);
    const flightSection = Object.entries(sections).find(([k]) => k.includes('flight') || k.includes('transport'));
    
    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                    ✈️ Flight & Transport Information
                </h3>
                <div className="flex gap-2">
                    <span className="text-slate-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg></span>
                    <span className="text-slate-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg></span>
                    <span className="text-slate-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></span>
                </div>
            </div>
            
            {flights.length > 0 ? (
                <table className="w-full">
                    <thead>
                        <tr className="bg-slate-50 text-xs text-slate-500 uppercase font-semibold tracking-wide">
                            <th className="px-5 py-3 text-left">Type</th>
                            <th className="px-5 py-3 text-left">Time</th>
                            <th className="px-5 py-3 text-left">Schedule</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {flights.map((f, i) => (
                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                <td className="px-5 py-3.5 text-slate-600 font-medium text-sm">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i % 7]}</td>
                                <td className="px-5 py-3.5 text-slate-600 text-sm">{f.time ? f.time.slice(11, 16) : '--:--'}</td>
                                <td className="px-5 py-3.5">
                                    <span className="bg-blue-50 text-primary text-xs font-semibold px-3 py-1 rounded-full border border-blue-100">{f.airline || 'Flight'} {f.flightNum || ''}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : flightSection ? (
                <div className="p-5">
                    <div className="markdown-content text-sm" dangerouslySetInnerHTML={{ __html: marked.parse(flightSection[1]) }}></div>
                </div>
            ) : (
                <div className="px-5 py-8 text-center text-slate-400 text-sm">
                    <div className="text-3xl mb-2">✈️</div>
                    No live flight data available for this route.
                    <div className="mt-1 text-xs">See the travel plan below for estimated transport options.</div>
                </div>
            )}
        </div>
    );
}

// ============================================================
// HOTEL CARD
// ============================================================

function HotelCard({ answer }) {
    const sections = splitMarkdownSections(answer);
    const hotelKey = Object.keys(sections).find(k => k.includes('hotel') || k.includes('accommodation') || k.includes('stay'));
    const hotelText = hotelKey ? sections[hotelKey] : null;
    const hotels = hotelText ? parseHotels(hotelText) : [];

    if (!hotelText) return null;

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">🏨 Hotel Suggestions</h3>
            </div>

            {hotels.length > 0 ? (
                <div className="divide-y divide-slate-100">
                    {hotels.map((hotel, i) => (
                        <div key={i} className="px-5 py-4 hover:bg-slate-50/50 transition-colors">
                            <div className="flex items-start justify-between gap-3 mb-2">
                                <div className="flex-1">
                                    <div className="font-semibold text-slate-800 text-sm">{hotel.name}{hotel.price ? <span className="text-slate-500 font-normal"> • ₹{hotel.price}/night</span> : ''}</div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <StarRating count={hotel.stars} />
                                    </div>
                                </div>
                                <div className="flex gap-2 flex-shrink-0">
                                    {i === 0 && <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-md border border-green-200">Active</span>}
                                    <button className="bg-primary text-white text-xs font-semibold px-3 py-1 rounded-lg hover:bg-primary-hover transition">{i === 0 ? 'Book' : 'View Offer'}</button>
                                </div>
                            </div>
                            {hotel.amenities.length > 0 && (
                                <div className="grid grid-cols-2 gap-x-4 mt-2">
                                    {hotel.amenities.slice(0, 4).map((a, j) => (
                                        <div key={j} className="text-xs text-slate-500 flex items-center gap-1 mb-0.5">
                                            <span className="text-primary">•</span> {a.slice(0, 40)}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {hotel.amenities.length === 0 && (
                                <div className="grid grid-cols-2 gap-x-4 mt-2">
                                    {['Free Wi-Fi', 'AC Room', 'Breakfast', 'Pool'][i] && (
                                        <>
                                            <div className="text-xs text-slate-500 flex items-center gap-1"><span className="text-primary">•</span> Free Wi-Fi</div>
                                            <div className="text-xs text-slate-500 flex items-center gap-1"><span className="text-primary">•</span> Central Location</div>
                                        </>
                                    )}
                                </div>
                            )}
                            {i === 0 && <span className="inline-block mt-2 bg-blue-50 text-primary text-xs font-semibold px-2 py-0.5 rounded border border-blue-100">Pool</span>}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="p-5 markdown-content text-sm" dangerouslySetInnerHTML={{ __html: marked.parse(hotelText) }}></div>
            )}
        </div>
    );
}

// ============================================================
// ITINERARY ACCORDION
// ============================================================

function ItineraryAccordion({ answer }) {
    const sections = splitMarkdownSections(answer);
    const itinKey = Object.keys(sections).find(k => k.includes('itinerary') || k.includes('day-by-day') || k.includes('plan') || k.includes('schedule'));
    const itinText = itinKey ? sections[itinKey] : answer;
    const days = parseDays(itinText || answer);
    const [openDay, setOpenDay] = useState(0);

    if (!days.length) {
        return (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800 text-base">📅 Day-by-Day Itinerary</h3>
                </div>
                <div className="p-5 markdown-content text-sm" dangerouslySetInnerHTML={{ __html: marked.parse(answer || '') }}></div>
            </div>
        );
    }

    return (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-base">📅 Day-by-Day Itinerary</h3>
            </div>
            <div className="divide-y divide-slate-100">
                {days.map((day, i) => (
                    <div key={i} className="relative">
                        {/* Timeline line */}
                        {i < days.length - 1 && (
                            <div className="absolute left-[1.85rem] top-14 bottom-0 w-0.5 bg-slate-200 z-0"></div>
                        )}
                        <button
                            onClick={() => setOpenDay(openDay === i ? -1 : i)}
                            className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors relative z-10"
                        >
                            {/* Circle dot */}
                            <div className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${openDay === i ? 'border-primary bg-primary' : 'border-slate-300 bg-white'}`}>
                                {openDay === i && <div className="w-2 h-2 rounded-full bg-white"></div>}
                            </div>
                            <span className="flex-1 text-left font-semibold text-slate-800">{day.title}</span>
                            <svg className={`w-5 h-5 text-slate-400 flex-shrink-0 transition-transform ${openDay === i ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/>
                            </svg>
                        </button>
                        {openDay === i && (
                            <div className="pl-[3.75rem] pr-5 pb-5">
                                <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-4 relative">
                                    <div className="flex items-center gap-2 mb-3 text-primary font-semibold text-sm">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                                        </svg>
                                        Activity · Budget
                                    </div>
                                    <div className="markdown-content text-sm" dangerouslySetInnerHTML={{ __html: marked.parse(day.content) }}></div>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ============================================================
// TRIP INSIGHTS CARD
// ============================================================

function TripInsightsCard({ pricePrediction, sentimentSummary, attractions }) {
    return (
        <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide text-slate-500">📊 Trip Insights</h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-100">
                        <div>
                            <div className="text-xs text-slate-500 font-medium">Est. Flight Price</div>
                            <div className="text-lg font-bold text-primary">
                                {pricePrediction && pricePrediction.estimated_price_usd ? `~$${pricePrediction.estimated_price_usd}` : 'N/A'}
                            </div>
                        </div>
                        <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary">✈️</div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-xl border border-green-100">
                        <div>
                            <div className="text-xs text-slate-500 font-medium">Hotel Sentiment</div>
                            <div className="text-sm font-semibold text-green-700">
                                {sentimentSummary && sentimentSummary.sample_size > 0 && sentimentSummary.label !== 'not_yet_analyzed' ? sentimentSummary.label : 'Positive'}
                            </div>
                        </div>
                        <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">🏨</div>
                    </div>
                </div>
            </div>

            {attractions && attractions.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
                    <h3 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wide text-slate-500">📍 Top Attractions</h3>
                    <ul className="space-y-2.5">
                        {attractions.slice(0, 5).map((att, i) => (
                            <li key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition">
                                <div className="w-8 h-8 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-center text-sm flex-shrink-0">
                                    {['🗼','🌴','🏛️','🗿','🏖️'][i] || '📌'}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-slate-700 text-sm truncate">{att.name}</div>
                                    {att.rate && <div className="text-xs text-primary font-semibold">⭐ {att.rate}</div>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

// ============================================================
// RESULTS VIEW
// ============================================================

function ResultsView({ travelData }) {
    if (!travelData) return null;
    const { answer, price_prediction, sentiment_summary, recommended_attractions, weather_results, flight_results, destCity, destCountry } = travelData;

    return (
        <div id="pdfContent" className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Left column */}
                <div className="lg:col-span-1 space-y-5">
                    <WeatherWidget weatherResults={weather_results} destCity={destCity} destCountry={destCountry} />
                    <TripInsightsCard pricePrediction={price_prediction} sentimentSummary={sentiment_summary} attractions={recommended_attractions} />
                </div>

                {/* Right column */}
                <div className="lg:col-span-2 space-y-5">
                    <FlightCard flightResults={flight_results} answer={answer} />
                    <HotelCard answer={answer} />
                    <ItineraryAccordion answer={answer} />
                </div>
            </div>
        </div>
    );
}

// ============================================================
// SIDEBAR
// ============================================================

function Sidebar({ onNewTrip }) {
    const user = window.USER_DATA;
    return (
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col h-full shrink-0 hidden md:flex">
            <div className="p-5 flex flex-col items-center border-b border-slate-100">
                <div className="relative mb-3">
                    <img src={user.picture} alt="Avatar" className="w-16 h-16 rounded-full border-3 border-white shadow object-cover" />
                    <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-500 border-2 border-white rounded-full"></div>
                </div>
                <h2 className="text-base font-bold text-slate-800">{user.name}</h2>
                <span className="px-3 py-0.5 mt-1 bg-blue-50 text-primary text-xs font-semibold rounded-full border border-blue-100">Premium User</span>
            </div>

            <nav className="flex-1 p-4 overflow-y-auto">
                <button onClick={onNewTrip} className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary-hover text-white rounded-xl font-semibold shadow-sm transition-colors mb-5 text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                    New Trip
                </button>

                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">My Saved Trips</h3>
                <ul className="space-y-0.5">
                    {[{icon:'🗼',label:'Saved Trips (Japan)'},{icon:'🌴',label:'Saved Trips #9'},{icon:'🏛️',label:'Saved Trips #2'},{icon:'🏖️',label:'Saved Trips #3'}].map((item, i) => (
                        <li key={i}>
                            <a href="#" className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-50 text-slate-700 hover:text-primary transition-all text-sm font-medium">
                                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-base flex-shrink-0">{item.icon}</div>
                                {item.label}
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>

            <div className="p-4 border-t border-slate-100 space-y-0.5">
                <a href="#" className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-slate-50 text-slate-600 text-sm font-medium transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    Settings
                </a>
                <a href="/logout" className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-red-50 text-slate-600 hover:text-red-600 text-sm font-medium transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                    Logout
                </a>
            </div>
        </aside>
    );
}

// ============================================================
// PROFILE DRAWER
// ============================================================

function ProfileDrawer({ isOpen, onClose }) {
    const user = window.USER_DATA;
    return (
        <React.Fragment>
            <div className={`fixed inset-0 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                style={{background:'rgba(15,23,42,0.4)', backdropFilter:'blur(4px)'}} onClick={onClose}></div>
            <div className={`fixed inset-y-0 right-0 z-50 w-80 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h2 className="font-bold text-xl text-slate-800">Profile</h2>
                    <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition">
                        <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
                <div className="p-6 flex flex-col items-center border-b border-slate-100">
                    <img src={user.picture} alt="User" className="w-20 h-20 rounded-full border-4 border-blue-50 shadow-sm mb-3" />
                    <h3 className="font-bold text-lg text-slate-800">{user.name}</h3>
                    <p className="text-slate-500 text-sm mb-4">Premium Member</p>
                    <button className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-hover transition w-full">Edit Profile</button>
                </div>
                <div className="p-4 space-y-1 flex-1">
                    <a href="#" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 text-slate-700 font-medium text-sm transition">⚙️ Preferences</a>
                    <a href="#" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 text-slate-700 font-medium text-sm transition">🌙 Dark Mode</a>
                    <a href="#" className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 text-slate-700 font-medium text-sm transition">📋 My Saved Plans</a>
                </div>
                <div className="p-5 border-t border-slate-100">
                    <a href="/logout" className="flex items-center justify-center gap-2 p-3 w-full bg-red-50 text-red-600 rounded-xl hover:bg-red-100 font-semibold text-sm transition">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                        Sign Out
                    </a>
                </div>
            </div>
        </React.Fragment>
    );
}

// ============================================================
// MAIN APP
// ============================================================

function App() {
    const user = window.USER_DATA;
    const [view, setView] = useState("prompt");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [promptText, setPromptText] = useState("");
    const [travelData, setTravelData] = useState(null);
    const [currentThreadId, setCurrentThreadId] = useState(localStorage.getItem("travel_thread_id") || null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const handleGenerate = async () => {
        if (!promptText.trim()) { setError("Please enter your travel request first."); return; }
        setIsLoading(true); setError("");
        try {
            const response = await fetch("/api/travel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: promptText, thread_id: currentThreadId })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || "Something went wrong.");
            setCurrentThreadId(data.thread_id);
            localStorage.setItem("travel_thread_id", data.thread_id);
            // Try to extract city name from prompt
            const toMatch = promptText.match(/to\s+([A-Z][a-z]+)/);
            data.destCity = toMatch ? toMatch[1] : promptText.split(' ').slice(-1)[0].replace(/[^a-zA-Z]/g,'');
            data.destCountry = null;
            setTravelData(data);
            setView("results");
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e) => { if (e.ctrlKey && e.key === "Enter") handleGenerate(); };

    return (
        <React.Fragment>
            <Sidebar onNewTrip={() => setView("prompt")} />
            <ProfileDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />

            <main className="flex-1 flex flex-col h-full relative overflow-hidden bg-[#F8FAFC]">

                {/* Sticky header for results */}
                {view === "results" && (
                    <header className="bg-white/80 backdrop-blur-md px-5 py-3.5 flex items-center justify-between border-b border-slate-200 shadow-sm sticky top-0 z-30">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-primary text-white rounded-xl flex items-center justify-center font-extrabold text-lg shadow">W</div>
                            <h1 className="font-bold text-slate-800 text-lg hidden sm:block tracking-tight">WANDERWISE AI</h1>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => copyToClipboard(travelData ? travelData.answer : '')} className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition shadow-sm">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                                Save
                            </button>
                            <button onClick={downloadPDF} className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition shadow-sm">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                                Download PDF
                            </button>
                            <button onClick={() => setView("prompt")} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-hover transition shadow-sm">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                Edit Prompt
                            </button>
                            <button onClick={() => setIsDrawerOpen(true)} className="w-9 h-9 ml-1 rounded-full overflow-hidden border-2 border-slate-200 hover:border-primary transition shadow-sm">
                                <img src={user.picture} alt="Profile" className="w-full h-full object-cover" />
                            </button>
                        </div>
                    </header>
                )}

                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                    {error && (
                        <div className="max-w-5xl mx-auto mb-5 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">{error}</div>
                    )}

                    {view === "prompt" ? (
                        <div className="max-w-2xl mx-auto flex flex-col justify-center min-h-[75vh]">
                            <div className="text-center mb-8">
                                <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center text-white font-extrabold text-2xl shadow-lg mx-auto mb-4">W</div>
                                <h1 className="text-3xl md:text-4xl font-extrabold text-slate-800 tracking-tight mb-2">
                                    Hey {user.firstName}, where's your<br/>next adventure? ✈️
                                </h1>
                                <p className="text-slate-500 text-sm">Tell me where you want to go and I'll plan everything.</p>
                            </div>

                            <div className="flex flex-wrap justify-center gap-2 mb-6">
                                {[
                                    { label: "7 Days in Japan on a budget", prompt: "7 Days in Japan on a budget including flights and hotels", className: "bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100" },
                                    { label: "Goa Weekend Getaway", prompt: "Weekend getaway to Goa from Mumbai under ₹10000", className: "bg-green-50 text-green-700 border-green-100 hover:bg-green-100" },
                                    { label: "Family Trip to Dubai", prompt: "Plan a 5 day family trip to Dubai with kids activities", className: "bg-purple-50 text-purple-700 border-purple-100 hover:bg-purple-100" },
                                    { label: "Solo in Thailand", prompt: "Solo backpacking in Thailand for 2 weeks", className: "bg-orange-50 text-orange-700 border-orange-100 hover:bg-orange-100" }
                                ].map((q, i) => (
                                    <button key={i} onClick={() => setPromptText(q.prompt)} className={`px-4 py-2 rounded-full text-sm font-medium border transition shadow-sm ${q.className}`}>
                                        {q.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <ResultsView travelData={travelData} />
                    )}
                </div>

                {view === "prompt" && (
                    <div className="sticky bottom-0 left-0 w-full px-4 pb-4 pt-2 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC] to-transparent pointer-events-none">
                        <div className="max-w-2xl mx-auto pointer-events-auto bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
                            <textarea
                                value={promptText}
                                onChange={(e) => setPromptText(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Plan a trip from Nagpur to Goa under 5000..."
                                className="w-full min-h-[90px] max-h-[200px] px-5 pt-4 pb-2 bg-transparent border-none resize-none focus:outline-none focus:ring-0 text-slate-700 text-base placeholder-slate-400"
                            ></textarea>
                            <div className="flex items-center justify-between px-4 pb-3">
                                <div className="flex gap-1.5">
                                    <button className="p-2 text-slate-400 hover:text-primary hover:bg-blue-50 rounded-lg transition">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                                    </button>
                                    <button className="p-2 text-slate-400 hover:text-primary hover:bg-blue-50 rounded-lg transition">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                                    </button>
                                    <button className="p-2 text-slate-400 hover:text-primary hover:bg-blue-50 rounded-lg transition">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
                                    </button>
                                </div>
                                <button onClick={handleGenerate} disabled={isLoading} className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-xl font-bold shadow-md transition-all disabled:opacity-70 text-sm">
                                    {isLoading ? (
                                        <div className="loader"></div>
                                    ) : (
                                        <React.Fragment>
                                            Generate Trip
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
                                        </React.Fragment>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </React.Fragment>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);