import { useState, useEffect, useMemo } from "react";

const CACHE_KEY = "str_finder_cache_v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function saveCache(listings, rentcast) {
  try {
    const payload = { listings, rentcast, savedAt: Date.now() };
    await window.storage.set(CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

async function loadCache() {
  try {
    const result = await window.storage.get(CACHE_KEY);
    if (!result?.value) return null;
    const payload = JSON.parse(result.value);
    if (!payload?.savedAt || Date.now() - payload.savedAt > CACHE_TTL_MS) return null;
    return payload;
  } catch { return null; }
}

const ZILLOW_KEY = "24f4c6b4a9mshf5296fdd34b1a70p16221fjsn7d96431f1636";
const ZILLOW_HOST = "real-estate-zillow-com.p.rapidapi.com";
const RENTCAST_KEY = "a3011813a6d94086ab81e98fcde57de0";

const COUNTIES = {
  Sullivan:  { zips: ["12748","12701"], driveHrs: 1.5, ski: ["Catamount (40 min)","Holiday Mtn (25 min)"], hiking: ["Catskill Center Trails (20 min)","D&H Rail Trail (15 min)"], strRegs: "Minimal restrictions. No county-wide STR law. Town-level permits vary — most are STR-friendly.", strScore: 95 },
  Delaware:  { zips: ["13753","12421"], driveHrs: 2.2, ski: ["Plattekill Mtn (30 min)","Bobcat Ski (35 min)"], hiking: ["Catskill High Peaks (25 min)","Pepacton Reservoir (15 min)"], strRegs: "No county STR regulation. Very rural — most towns have no short-term rental ordinances.", strScore: 97 },
  Greene:    { zips: ["12442","12427"], driveHrs: 2.1, ski: ["Windham Mtn (20 min)","Hunter Mtn (30 min)"], hiking: ["Catskill Escarpment (15 min)","North-South Lake (20 min)"], strRegs: "Light touch. Some towns require basic registration but no caps or moratoriums.", strScore: 88 },
  Ulster:    { zips: ["12401","12484"], driveHrs: 1.8, ski: ["Belleayre Mtn (35 min)","Hunter Mtn (45 min)"], hiking: ["Slide Mtn (30 min)","Mohonk Preserve (25 min)"], strRegs: "Mixed — Woodstock and Kingston have stricter rules. Rural Ulster towns remain permissive.", strScore: 75 },
  Schoharie: { zips: ["12043","12157"], driveHrs: 2.3, ski: ["Windham Mtn (35 min)","Plattekill Mtn (40 min)"], hiking: ["Vroman's Nose (15 min)","Catskill Wilderness (30 min)"], strRegs: "Very limited regulation. Rural county with almost no STR enforcement infrastructure.", strScore: 93 },
  Otsego:    { zips: ["13326","13820"], driveHrs: 2.4, ski: ["Plattekill Mtn (45 min)","Catamount (55 min)"], hiking: ["Glimmerglass State Park (10 min)","Catskill trails (40 min)"], strRegs: "No county-level STR rules. Cooperstown area has light local rules due to tourism culture.", strScore: 85 },
};

// STR multiplier: Airbnb nightly rates typically 2.2–2.8x long-term monthly rent / 30
const STR_MULT = 2.5;
const STR_OCCUPANCY = { Sullivan: 70, Delaware: 67, Greene: 72, Ulster: 68, Schoharie: 63, Otsego: 65 };

function nightlyFromRentcast(monthlyRent) {
  return Math.round((monthlyRent / 30) * STR_MULT);
}

function fallbackNightly(beds) {
  return beds <= 1 ? 130 : beds === 2 ? 185 : beds === 3 ? 245 : 320;
}

function calcMetrics(price, beds, county, rentcastData) {
  let nightly, dataSource;
  if (rentcastData) {
    const byBed = rentcastData.rentalData?.dataByBedrooms?.find(d => d.bedroomCount === beds)
      || rentcastData.rentalData?.dataByBedrooms?.find(d => d.bedroomCount === beds - 1)
      || rentcastData.rentalData?.dataByBedrooms?.[0];
    const monthlyRent = byBed?.averageRent || rentcastData.rentalData?.averageRent;
    if (monthlyRent) { nightly = nightlyFromRentcast(monthlyRent); dataSource = "rentcast"; }
    else { nightly = fallbackNightly(beds); dataSource = "estimated"; }
  } else {
    nightly = fallbackNightly(beds);
    dataSource = "estimated";
  }
  const occupancy = STR_OCCUPANCY[county] || 65;
  const revenue = Math.round(nightly * 365 * (occupancy / 100));
  const expenses = Math.round(price * 0.045 + revenue * 0.12);
  const capRate = +((revenue - expenses) / price * 100).toFixed(1);
  return { nightly, occupancy, revenue, expenses, capRate, dataSource };
}

function strScore(county, capRate) {
  return Math.min(99, Math.round((COUNTIES[county]?.strScore || 80) * 0.6 + Math.min(capRate * 2, 40)));
}

function buildTags(listing) {
  const t = [];
  if (listing.price < 280000) t.push("Under $280k");
  if (listing.capRate >= 13) t.push("High cap rate");
  if (listing.sqft && listing.price / listing.sqft < 180) t.push("Low $/sqft");
  if (COUNTIES[listing.county]?.strScore >= 93) t.push("STR-friendly county");
  if (listing.beds >= 4) t.push("4+ bedrooms");
  if (listing.dataSource === "rentcast") t.push("Rentcast verified");
  return t.slice(0, 4);
}

function ScoreBadge({ score }) {
  const c = score >= 90 ? "#1D9E75" : score >= 80 ? "#639922" : score >= 70 ? "#BA7517" : "#D85A30";
  return <span style={{ background: c + "22", color: c, border: `1px solid ${c}55`, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 500 }}>{score} STR</span>;
}

function SourceBadge({ source }) {
  return source === "rentcast"
    ? <span style={{ background: "#E6F1FB", color: "#185FA5", border: "1px solid #B5D4F4", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 500 }}>Rentcast</span>
    : <span style={{ background: "var(--color-background-secondary)", color: "var(--color-text-tertiary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4, padding: "1px 6px", fontSize: 10 }}>Est.</span>;
}

function Tag({ label }) {
  return <span style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 4, padding: "2px 7px", fontSize: 11, color: "var(--color-text-secondary)" }}>{label}</span>;
}

function StatBox({ label, value }) {
  return (
    <div style={{ background: "var(--color-background-secondary)", borderRadius: 6, padding: "6px 8px" }}>
      <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function ListingCard({ listing, onSelect }) {
  return (
    <div onClick={() => onSelect(listing)}
      style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "var(--color-border-secondary)"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "var(--color-border-tertiary)"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, paddingRight: 8 }}>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
            {listing.propType} · {listing.county} Co. · {COUNTIES[listing.county]?.driveHrs}h NYC
            <SourceBadge source={listing.dataSource} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{listing.address}</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{listing.beds}bd · {listing.baths}ba{listing.sqft ? ` · ${listing.sqft.toLocaleString()} sqft` : ""}</div>
        </div>
        <ScoreBadge score={listing.score} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, margin: "10px 0" }}>
        <StatBox label="Price" value={"$" + (listing.price / 1000).toFixed(0) + "k"} />
        <StatBox label="Cap rate" value={listing.capRate + "%"} />
        <StatBox label="Est. nightly" value={"$" + listing.nightly} />
        <StatBox label="Ann. revenue" value={"$" + (listing.revenue / 1000).toFixed(0) + "k"} />
      </div>
      {listing.tags?.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{listing.tags.map(t => <Tag key={t} label={t} />)}</div>}
    </div>
  );
}

function DetailPanel({ listing, onClose, rentcastMarket }) {
  const [q, setQ] = useState("");
  const [resp, setResp] = useState("");
  const [loading, setLoading] = useState(false);
  const co = COUNTIES[listing.county];
  const net = listing.revenue - listing.expenses;
  const mktAvgRent = rentcastMarket?.rentalData?.averageRent;
  const mktAvgPrice = rentcastMarket?.saleData?.averagePrice;

  async function ask() {
    if (!q.trim()) return;
    setLoading(true); setResp("");
    try {
      const mktContext = mktAvgRent ? `\nRentcast market avg rent (${listing.county}): $${mktAvgRent}/mo\nRentcast market avg sale price: $${mktAvgPrice?.toLocaleString() || "N/A"}` : "";
      const prompt = `You are an expert Airbnb STR investment analyst. Analyze this property:

Address: ${listing.address}
County: ${listing.county}, NY · ${co?.driveHrs}h from NYC
Type: ${listing.propType} · ${listing.beds}bd/${listing.baths}ba · ${listing.sqft} sqft
Price: $${listing.price?.toLocaleString()} · Built ${listing.yearBuilt}
Revenue data source: ${listing.dataSource === "rentcast" ? "Rentcast market data" : "Estimated"}
Est. Nightly Rate: $${listing.nightly} · Occupancy: ${listing.occupancy}%
Annual Revenue: $${listing.revenue?.toLocaleString()} · Expenses: $${listing.expenses?.toLocaleString()}
Net Income: $${net?.toLocaleString()}/yr · Cap Rate: ${listing.capRate}%
STR Score: ${listing.score}/100${mktContext}
STR Regulations: ${co?.strRegs}
Nearby Ski: ${co?.ski?.join(", ")}
Nearby Hiking: ${co?.hiking?.join(", ")}

User question: ${q}

Be concise, direct, and data-driven. Reference specific numbers. Be honest about risks and data limitations.`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] })
      });
      const data = await res.json();
      setResp(data.content?.[0]?.text || "No response.");
    } catch { setResp("Error reaching AI. Please try again."); }
    setLoading(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "var(--color-background-primary)", borderRadius: 16, border: "0.5px solid var(--color-border-tertiary)", width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
              {listing.propType} · {listing.county} County · {co?.driveHrs}h from NYC <SourceBadge source={listing.dataSource} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 500 }}>{listing.address}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 2 }}>{listing.beds}bd · {listing.baths}ba · {listing.sqft?.toLocaleString()} sqft · Built {listing.yearBuilt}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-text-secondary)" }}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
          {[["List price", "$" + listing.price?.toLocaleString()], ["Cap rate", listing.capRate + "%"], ["Est. nightly", "$" + listing.nightly], ["Occupancy", listing.occupancy + "%"], ["Ann. revenue", "$" + listing.revenue?.toLocaleString()], ["Net income", "$" + net?.toLocaleString() + "/yr"]].map(([l, v]) => (
            <div key={l} style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{v}</div>
            </div>
          ))}
        </div>

        {mktAvgRent && (
          <div style={{ background: "#E6F1FB", border: "0.5px solid #B5D4F4", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "#185FA5", marginBottom: 4 }}>Rentcast market data — {listing.county} County</div>
            <div style={{ display: "flex", gap: 16, fontSize: 13, color: "#185FA5" }}>
              <span>Avg market rent: <strong>${mktAvgRent?.toLocaleString()}/mo</strong></span>
              {mktAvgPrice && <span>Avg sale price: <strong>${(mktAvgPrice / 1000).toFixed(0)}k</strong></span>}
            </div>
            <div style={{ fontSize: 11, color: "#378ADD", marginTop: 4 }}>Nightly rate estimated at {STR_MULT}x long-term market rent ÷ 30 days</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 6 }}>Ski nearby</div>
            {co?.ski.map(s => <div key={s} style={{ fontSize: 12, marginBottom: 3 }}>⛷ {s}</div>)}
          </div>
          <div style={{ border: "0.5px solid var(--color-border-tertiary)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 6 }}>Hiking nearby</div>
            {co?.hiking.map(h => <div key={h} style={{ fontSize: 12, marginBottom: 3 }}>🥾 {h}</div>)}
          </div>
        </div>

        <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "10px 12px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>STR regulations — {listing.county} County</div>
          <div style={{ fontSize: 13 }}>{co?.strRegs}</div>
        </div>

        {listing.url && <a href={listing.url} style={{ fontSize: 13, color: "var(--color-text-info)", display: "block", marginBottom: 14 }}>View on Zillow →</a>}

        <div style={{ borderTop: "0.5px solid var(--color-border-tertiary)", paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>AI deal analyzer</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {["Is this a good STR deal?", "What are the risks?", "Estimate ROI with 20% down", "How does this compare to the county market?"].map(s => (
              <button key={s} onClick={() => setQ(s)} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6 }}>{s}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && ask()} placeholder="Ask anything about this listing..." style={{ flex: 1, fontSize: 13 }} />
            <button onClick={ask} style={{ padding: "0 16px", fontSize: 13 }}>{loading ? "..." : "Ask ↗"}</button>
          </div>
          {resp && <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, background: "var(--color-background-secondary)", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap" }}>{resp}</div>}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [allListings, setAllListings] = useState([]);
  const [rentcastByZip, setRentcastByZip] = useState({});
  const [fetchStatus, setFetchStatus] = useState("idle");
  const [rentcastStatus, setRentcastStatus] = useState("idle");
  const [errors, setErrors] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [selCounty, setSelCounty] = useState("All");
  const [maxPrice, setMaxPrice] = useState(600000);
  const [minCap, setMinCap] = useState(0);
  const [minBeds, setMinBeds] = useState(0);
  const [sortBy, setSortBy] = useState("score");
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState("listings");

  async function fetchRentcast() {
    setRentcastStatus("loading");
    const results = {};
    const allZips = Object.values(COUNTIES).flatMap(c => c.zips);
    for (const zip of allZips) {
      try {
        const res = await fetch(`https://api.rentcast.io/v1/markets?zipCode=${zip}&dataType=Rental`, {
          headers: { "X-Api-Key": RENTCAST_KEY, "accept": "application/json" }
        });
        if (res.ok) {
          const data = await res.json();
          results[zip] = data;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    setRentcastByZip(results);
    setRentcastStatus("done");
    return results;
  }

  async function fetchZillow(zip, county, rcData) {
    try {
      const url = `https://real-estate-zillow-com.p.rapidapi.com/v1/search/sale?location_or_rid=${encodeURIComponent(zip + " NY")}&listing_types=agent&property_types=house&sort=relevant&page=1`;
      const res = await fetch(url, { headers: { "X-RapidAPI-Key": ZILLOW_KEY, "X-RapidAPI-Host": ZILLOW_HOST } });
      const rawText = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`);
      let data;
      try { data = JSON.parse(rawText); } catch { throw new Error(`Bad JSON: ${rawText.slice(0, 200)}`); }
      const props = data?.results || data?.props || data?.listings || data?.data || [];
      setErrors(prev => [...prev, `DEBUG ${zip}: status=${res.status} keys=${Object.keys(data).join(",")} props=${props.length}`]);
      return props.map(p => {
        const price = p.price || p.listPrice || p.unformattedPrice || 0;
        const beds = p.bedrooms || p.beds || 3;
        const sqft = p.livingArea || p.sqft || p.area || 1400;
        const metrics = calcMetrics(price, beds, county, rcData);
        const listing = {
          id: p.zpid || p.id || Math.random(),
          county, zip,
          address: p.address || p.streetAddress || `${zip}, NY`,
          price, beds,
          baths: p.bathrooms || p.baths || 2,
          sqft,
          yearBuilt: p.yearBuilt || "N/A",
          propType: (p.homeType || p.propertyType || p.type || "House").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
          url: p.detailUrl ? `https://www.zillow.com${p.detailUrl}` : p.url || null,
          ...metrics,
        };
        listing.score = strScore(county, listing.capRate);
        listing.tags = buildTags(listing);
        return listing;
      }).filter(l => l.price > 50000 && l.price <= 600000);
    } catch (e) {
      setErrors(prev => [...prev, `${county} (${zip}): ${e.message}`]);
      return [];
    }
  }

  async function fetchAll(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = await loadCache();
      if (cached) {
        setAllListings(cached.listings);
        setRentcastByZip(cached.rentcast);
        setLastUpdated(cached.savedAt);
        setFromCache(true);
        setFetchStatus("done");
        setRentcastStatus("done");
        return;
      }
    }
    setFromCache(false);
    setFetchStatus("loading");
    setAllListings([]);
    setErrors([]);
    const rcData = await fetchRentcast();
    const results = [];
    for (const [county, info] of Object.entries(COUNTIES)) {
        const rc = rcData[info.zips[0]] || null;
        const listings = await fetchZillow(info.zips[0], county, rc);
        results.push(...listings);
        setAllListings([...results]);
        await new Promise(r => setTimeout(r, 1500));
    }
    saveCache(results, rcData);
    setLastUpdated(Date.now());
    setFetchStatus("done");
  }

  useEffect(() => { fetchAll(false); }, [fetchAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => allListings.filter(l =>
    (selCounty === "All" || l.county === selCounty) &&
    l.price <= maxPrice && l.capRate >= minCap && l.beds >= minBeds
  ).sort((a, b) =>
    sortBy === "score" ? b.score - a.score :
    sortBy === "capRate" ? b.capRate - a.capRate :
    sortBy === "price" ? a.price - b.price :
    sortBy === "revenue" ? b.revenue - a.revenue : 0
  ), [allListings, selCounty, maxPrice, minCap, minBeds, sortBy]);

  const rentcastCount = Object.keys(rentcastByZip).length;
  const verifiedCount = allListings.filter(l => l.dataSource === "rentcast").length;

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)", padding: "16px 0" }}>
      <h2 style={{ fontSize: 20, fontWeight: 500, margin: "0 0 4px" }}>Upstate NY STR Investment Finder</h2>
      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "0 0 6px" }}>Live Zillow listings + Rentcast market data · STR-friendly upstate NY counties · &lt;2.5h NYC</p>

      {rentcastStatus !== "idle" && (
        <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 12 }}>
          <span style={{ background: "#E6F1FB", color: "#185FA5", border: "0.5px solid #B5D4F4", borderRadius: 6, padding: "3px 10px" }}>
            {rentcastStatus === "loading" ? `Rentcast: fetching market data (${rentcastCount} ZIPs done)…` : `Rentcast: ${rentcastCount} ZIP markets loaded · ${verifiedCount} listings verified`}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, borderBottom: "0.5px solid var(--color-border-tertiary)", paddingBottom: 12 }}>
        {["listings", "counties"].map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{ fontSize: 13, padding: "5px 14px", borderRadius: 6, background: activeTab === t ? "var(--color-background-secondary)" : "transparent", fontWeight: activeTab === t ? 500 : 400 }}>
            {t === "listings" ? "Property listings" : "County guide"}
          </button>
        ))}
      </div>

      {activeTab === "listings" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>County</div>
              <select value={selCounty} onChange={e => setSelCounty(e.target.value)} style={{ width: "100%", fontSize: 13 }}>
                {["All", ...Object.keys(COUNTIES)].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>Max price: ${(maxPrice / 1000).toFixed(0)}k</div>
              <input type="range" min={150000} max={600000} step={10000} value={maxPrice} onChange={e => setMaxPrice(+e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>Min cap rate: {minCap.toFixed(1)}%</div>
              <input type="range" min={0} max={15} step={0.5} value={minCap} onChange={e => setMinCap(+e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>Min beds: {minBeds === 0 ? "Any" : minBeds + "+"}</div>
              <input type="range" min={0} max={5} step={1} value={minBeds} onChange={e => setMinBeds(+e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>Sort by</div>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ width: "100%", fontSize: 13 }}>
                <option value="score">STR score</option>
                <option value="capRate">Cap rate</option>
                <option value="price">Price (low–high)</option>
                <option value="revenue">Est. revenue</option>
              </select>
            </div>
          </div>

          {fetchStatus === "loading" && (
            <div style={{ background: "var(--color-background-secondary)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#1D9E75", animation: "pulse 1.2s infinite" }}></span>
              Fetching live listings… {allListings.length} found so far
            </div>
          )}

          {errors.length > 0 && (
            <div style={{ background: "var(--color-background-warning)", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "var(--color-text-warning)" }}>
              Some requests hit rate limits: {errors.slice(0, 2).join(" · ")}
            </div>
          )}

          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 12 }}>
            {filtered.length} listing{filtered.length !== 1 ? "s" : ""} {fetchStatus === "done" ? "· live data" : "· loading…"} · click any to analyze with AI
          </div>

          <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
          <div style={{ display: "grid", gap: 10 }}>
            {filtered.length === 0 && fetchStatus === "done"
              ? <div style={{ fontSize: 14, color: "var(--color-text-secondary)", padding: 24, textAlign: "center" }}>No listings match your filters.</div>
              : filtered.map(l => <ListingCard key={l.id} listing={l} onSelect={setSelected} />)}
          </div>

          {fetchStatus === "done" && (
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
                {fromCache ? "Loaded from cache · " : "Fetched live · "}
                {lastUpdated ? `Last updated: ${new Date(lastUpdated).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
              </div>
              <button onClick={() => fetchAll(true)} style={{ fontSize: 13, padding: "6px 18px" }}>Refresh listings ↗</button>
            </div>
          )}
        </>
      )}

      {activeTab === "counties" && (
        <div style={{ display: "grid", gap: 12 }}>
          {Object.entries(COUNTIES).map(([name, co]) => {
            const zipData = rentcastByZip[co.zips[0]];
            const avgRent = zipData?.rentalData?.averageRent;
            const avgPrice = zipData?.saleData?.averagePrice;
            return (
              <div key={name} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 500 }}>{name} County</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{co.driveHrs}h from NYC</div>
                  </div>
                  <ScoreBadge score={co.strScore} />
                </div>
                {avgRent && (
                  <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 12 }}>
                    <span style={{ background: "#E6F1FB", color: "#185FA5", border: "0.5px solid #B5D4F4", borderRadius: 6, padding: "3px 10px" }}>Avg rent: ${avgRent?.toLocaleString()}/mo</span>
                    {avgPrice && <span style={{ background: "#E6F1FB", color: "#185FA5", border: "0.5px solid #B5D4F4", borderRadius: 6, padding: "3px 10px" }}>Avg sale: ${(avgPrice / 1000).toFixed(0)}k</span>}
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Ski options</div>
                    {co.ski.map(s => <div key={s} style={{ fontSize: 12, marginBottom: 2 }}>⛷ {s}</div>)}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Hiking options</div>
                    {co.hiking.map(h => <div key={h} style={{ fontSize: 12, marginBottom: 2 }}>🥾 {h}</div>)}
                  </div>
                </div>
                <div style={{ background: "var(--color-background-secondary)", borderRadius: 6, padding: "8px 10px", fontSize: 12, marginBottom: 10 }}>
                  <span style={{ fontWeight: 500 }}>STR rules: </span>{co.strRegs}
                </div>
                <button onClick={() => { setSelCounty(name); setActiveTab("listings"); }} style={{ fontSize: 12, padding: "5px 12px" }}>View {name} listings ↗</button>
              </div>
            );
          })}
        </div>
      )}

      {selected && <DetailPanel listing={selected} onClose={() => setSelected(null)} rentcastMarket={rentcastByZip[selected.zip]} />}
    </div>
  );
}