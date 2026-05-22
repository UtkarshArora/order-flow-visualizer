const VENUES = [
  { id: "OMS", label: "Retail OMS", type: "origin" },
  { id: "SOR", label: "Smart Router", type: "router" },
  { id: "NYSE", label: "NYSE", type: "lit" },
  { id: "NASDAQ", label: "NASDAQ", type: "lit" },
  { id: "IEX", label: "IEX", type: "lit" },
  { id: "EDGX", label: "Cboe EDGX", type: "lit" },
  { id: "DARK-A", label: "Dark Pool A", type: "dark" },
  { id: "DARK-B", label: "Dark Pool B", type: "dark" },
  { id: "WHOLE", label: "Wholesaler", type: "wholesale" },
  { id: "ATS-X", label: "ATS-X", type: "dark" }
];

const STATIC_LINKS = [
  { source: "OMS", target: "SOR" },
  { source: "SOR", target: "NYSE" },
  { source: "SOR", target: "NASDAQ" },
  { source: "SOR", target: "IEX" },
  { source: "SOR", target: "EDGX" },
  { source: "SOR", target: "DARK-A" },
  { source: "SOR", target: "DARK-B" },
  { source: "SOR", target: "WHOLE" },
  { source: "SOR", target: "ATS-X" }
];

const ROUTABLE_VENUES = VENUES.filter((v) =>
  ["lit", "dark", "wholesale"].includes(v.type)
);

const COLORS = {
  origin: "#1f3a5f",
  router: "#0065ff",
  lit: "#00a878",
  dark: "#f59f00",
  wholesale: "#8b5cf6"
};

const fmtInt = d3.format(",d");
const fmtPct = d3.format(".1%");
const fmtBps = d3.format("+.1f");
const fmtMoney = d3.format(".2f");

const state = {
  running: true,
  tickMs: 850,
  fillSeq: 0,
  fills: [],
  maxStoredFills: 1400,
  perRouteStats: new Map(),
  perVenueStats: new Map(),
  midPrice: 182.24,
  depth: { bids: [], asks: [] },
  timerId: null
};

const kpiGrid = d3.select("#kpiGrid");
const fillsCountLabel = d3.select("#fillsCountLabel");
const tape = d3.select("#tape");

const networkHost = d3.select("#networkViz");
const bookHost = d3.select("#bookViz");
const treemapHost = d3.select("#treemapViz");

let network;
let book;
let treemap;

initDepth();
initVenueStats();
setupNetworkViz();
setupBookViz();
setupTreemapViz();
setupControls();
bootstrapInitialFlow();

state.timerId = setInterval(() => {
  if (!state.running) {
    return;
  }
  runTick(rollPoisson(4, 2));
}, state.tickMs);

window.addEventListener("resize", debounce(handleResize, 180));

function setupControls() {
  const pauseBtn = d3.select("#pauseBtn");
  const burstBtn = d3.select("#burstBtn");
  const resetBtn = d3.select("#resetBtn");

  pauseBtn.on("click", () => {
    state.running = !state.running;
    pauseBtn.text(state.running ? "Pause Stream" : "Resume Stream");
  });

  burstBtn.on("click", () => {
    runTick(50);
  });

  resetBtn.on("click", () => {
    state.fills = [];
    state.fillSeq = 0;
    state.midPrice = 182.24;
    state.perRouteStats.clear();
    state.perVenueStats.clear();
    initVenueStats();
    initDepth();
    runTick(80);
  });
}

function bootstrapInitialFlow() {
  runTick(110);
}

function runTick(count) {
  for (let i = 0; i < count; i += 1) {
    processFill(createSyntheticFill());
  }
  updateDepth();
  renderBook();
  renderKpis();
  renderTreemap();
  renderTape();
  renderLinkWeights();
  fillsCountLabel.text(`${fmtInt(state.fills.length)} fills processed`);
}

function createSyntheticFill() {
  const venue = weightedVenuePick();
  const orderType = pickOrderType(venue.type);
  const requestedQty = randomInt(120, 2200);

  let fillFraction = 0.7 + Math.random() * 0.3;
  if (venue.type === "dark") {
    fillFraction -= Math.random() * 0.15;
  }
  if (venue.type === "wholesale") {
    fillFraction += Math.random() * 0.08;
  }
  fillFraction = Math.max(0.45, Math.min(1, fillFraction));

  const fillQty = Math.round(requestedQty * fillFraction);
  const isBuy = Math.random() >= 0.5;
  const latencyMs = Math.max(
    5,
    Math.round(randomNormal(38 + venueLatencyBias(venue.type), 11))
  );

  const bpsSkew = venue.type === "dark" ? -0.25 : venue.type === "wholesale" ? -0.1 : 0.15;
  const slippageBps = randomNormal(bpsSkew, 0.75);
  const px = state.midPrice * (1 + slippageBps / 10000);

  return {
    id: `F-${state.fillSeq++}`,
    ts: new Date(),
    side: isBuy ? "BUY" : "SELL",
    venueId: venue.id,
    venueLabel: venue.label,
    venueType: venue.type,
    orderType,
    requestedQty,
    fillQty,
    fillRate: fillQty / requestedQty,
    latencyMs,
    slippageBps,
    price: px,
    route: ["OMS", "SOR", venue.id]
  };
}

function processFill(fill) {
  state.fills.push(fill);
  if (state.fills.length > state.maxStoredFills) {
    state.fills.shift();
  }

  for (let i = 0; i < fill.route.length - 1; i += 1) {
    const key = `${fill.route[i]}->${fill.route[i + 1]}`;
    const stats = state.perRouteStats.get(key) || { shares: 0, fills: 0 };
    stats.shares += fill.fillQty;
    stats.fills += 1;
    state.perRouteStats.set(key, stats);
  }

  const venueStats = state.perVenueStats.get(fill.venueId);
  venueStats.shares += fill.fillQty;
  venueStats.fills += 1;
  venueStats.requested += fill.requestedQty;
  venueStats.slippageTotal += fill.slippageBps;
  venueStats.latencyTotal += fill.latencyMs;

  animateFillParticle(fill);
}

function setupNetworkViz() {
  const { width, height } = dimensions(networkHost);
  const svg = networkHost
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  svg
    .append("rect")
    .attr("width", width)
    .attr("height", height)
    .attr("rx", 14)
    .attr("fill", "#f9fbff");

  const linkLayer = svg.append("g");
  const particleLayer = svg.append("g");
  const nodeLayer = svg.append("g");
  const labelLayer = svg.append("g");

  const nodes = VENUES.map((d) => ({ ...d }));
  const links = STATIC_LINKS.map((d) => ({ ...d }));

  const sim = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(92).strength(0.95))
    .force("charge", d3.forceManyBody().strength(-460))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide().radius(34));

  const linkSel = linkLayer
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", "#adc3e3")
    .attr("stroke-linecap", "round")
    .attr("stroke-opacity", 0.9);

  const nodeSel = nodeLayer
    .selectAll("circle")
    .data(nodes)
    .join("circle")
    .attr("r", (d) => (d.type === "router" ? 18 : 14))
    .attr("fill", (d) => COLORS[d.type])
    .attr("stroke", "#fff")
    .attr("stroke-width", 2);

  const labelSel = labelLayer
    .selectAll("text")
    .data(nodes)
    .join("text")
    .attr("font-size", 11)
    .attr("fill", "#334155")
    .attr("font-weight", 700)
    .attr("text-anchor", "middle")
    .text((d) => d.label);

  sim.on("tick", () => {
    linkSel
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    nodeSel.attr("cx", (d) => d.x).attr("cy", (d) => d.y);

    labelSel.attr("x", (d) => d.x).attr("y", (d) => d.y + 27);
  });

  network = {
    svg,
    sim,
    nodes,
    links,
    linkSel,
    particleLayer
  };
}

function animateFillParticle(fill) {
  if (!network) {
    return;
  }
  const sourceNode = network.nodes.find((n) => n.id === "SOR");
  const targetNode = network.nodes.find((n) => n.id === fill.venueId);
  if (!sourceNode || !targetNode || sourceNode.x == null || targetNode.x == null) {
    return;
  }

  const color = fill.side === "BUY" ? "#0065ff" : "#e4572e";
  const radius = Math.max(2.5, Math.min(5.4, Math.sqrt(fill.fillQty) / 7));

  const dot = network.particleLayer
    .append("circle")
    .attr("cx", sourceNode.x)
    .attr("cy", sourceNode.y)
    .attr("r", radius)
    .attr("fill", color)
    .attr("opacity", 0.85);

  dot
    .transition()
    .duration(390 + fill.latencyMs * 3)
    .ease(d3.easeCubicOut)
    .attrTween("cx", () => d3.interpolateNumber(sourceNode.x, targetNode.x))
    .attrTween("cy", () => d3.interpolateNumber(sourceNode.y, targetNode.y))
    .attr("opacity", 0.15)
    .remove();
}

function renderLinkWeights() {
  const maxShares = d3.max(
    [...state.perRouteStats.values()].map((d) => d.shares),
    (d) => d
  );
  const widthScale = d3
    .scaleSqrt()
    .domain([0, maxShares || 1])
    .range([1.2, 10]);

  network.linkSel
    .attr("stroke-width", (d) => {
      const key = `${sourceId(d)}->${targetId(d)}`;
      const shares = state.perRouteStats.get(key)?.shares || 0;
      return widthScale(shares);
    })
    .attr("stroke", (d) => {
      const key = `${sourceId(d)}->${targetId(d)}`;
      const fills = state.perRouteStats.get(key)?.fills || 0;
      return fills > 0 ? "#4f83cc" : "#adc3e3";
    });
}

function setupBookViz() {
  const { width, height } = dimensions(bookHost);
  const svg = bookHost
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("rect").attr("width", width).attr("height", height).attr("fill", "#f9fbff");

  book = { svg, width, height };
  renderBook();
}

function renderBook() {
  const { svg, width, height } = book;
  const margin = { top: 14, right: 10, bottom: 20, left: 10 };

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const centerX = margin.left + innerW / 2;

  const levels = state.depth.bids
    .map((d) => ({ ...d, side: "bid" }))
    .concat(state.depth.asks.map((d) => ({ ...d, side: "ask" })));

  const y = d3
    .scaleBand()
    .domain(levels.map((d) => d.price.toFixed(2)))
    .range([margin.top, margin.top + innerH])
    .padding(0.11);

  const maxSize = d3.max(levels, (d) => d.size) || 1;
  const x = d3.scaleLinear().domain([0, maxSize]).range([0, innerW / 2 - 22]);

  const bars = svg.selectAll("rect.book-bar").data(levels, (d) => `${d.side}-${d.price.toFixed(2)}`);

  bars
    .join(
      (enter) =>
        enter
          .append("rect")
          .attr("class", "book-bar")
          .attr("rx", 3)
          .attr("ry", 3)
          .attr("x", centerX)
          .attr("width", 0)
          .attr("y", (d) => y(d.price.toFixed(2)))
          .attr("height", y.bandwidth())
          .attr("fill", (d) => (d.side === "bid" ? "#00a878" : "#e4572e"))
          .call((sel) =>
            sel
              .transition()
              .duration(340)
              .attr("x", (d) =>
                d.side === "bid" ? centerX - x(d.size) : centerX
              )
              .attr("width", (d) => x(d.size))
          ),
      (update) =>
        update.call((sel) =>
          sel
            .transition()
            .duration(340)
            .attr("x", (d) =>
              d.side === "bid" ? centerX - x(d.size) : centerX
            )
            .attr("y", (d) => y(d.price.toFixed(2)))
            .attr("height", y.bandwidth())
            .attr("width", (d) => x(d.size))
        ),
      (exit) => exit.transition().duration(200).attr("width", 0).remove()
    );

  svg
    .selectAll("line.mid")
    .data([state.midPrice])
    .join("line")
    .attr("class", "mid")
    .attr("x1", centerX)
    .attr("x2", centerX)
    .attr("y1", margin.top - 2)
    .attr("y2", margin.top + innerH + 3)
    .attr("stroke", "#0f172a")
    .attr("stroke-width", 1.1)
    .attr("stroke-dasharray", "3 3");

  svg
    .selectAll("text.mid-label")
    .data([state.midPrice])
    .join("text")
    .attr("class", "mid-label legend")
    .attr("x", centerX + 6)
    .attr("y", height - 4)
    .text((d) => `Mid ${fmtMoney(d)}`);

  const topLevels = [state.depth.asks[0], state.depth.bids[0]].filter(Boolean);

  svg
    .selectAll("text.top-book")
    .data(topLevels, (d) => d.side)
    .join("text")
    .attr("class", "top-book legend")
    .attr("x", (_d, i) => (i === 0 ? width * 0.06 : width * 0.58))
    .attr("y", 14)
    .text((d) => `${d.side.toUpperCase()} ${fmtMoney(d.price)} x ${fmtInt(d.size)}`);
}

function setupTreemapViz() {
  const { width, height } = dimensions(treemapHost);
  const svg = treemapHost
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("rect").attr("width", width).attr("height", height).attr("fill", "#f9fbff");

  treemap = { svg, width, height };
  renderTreemap();
}

function renderTreemap() {
  const entries = [...state.perVenueStats.entries()].map(([id, stats]) => ({
    name: id,
    label: VENUES.find((v) => v.id === id)?.label || id,
    value: Math.max(0, stats.shares),
    slippage: stats.fills ? stats.slippageTotal / stats.fills : 0
  }));

  const data = {
    name: "allocation",
    children: entries.filter((d) => d.value > 0)
  };

  if (!data.children.length) {
    return;
  }

  const root = d3
    .hierarchy(data)
    .sum((d) => d.value)
    .sort((a, b) => b.value - a.value);

  d3
    .treemap()
    .size([treemap.width, treemap.height])
    .paddingInner(2)
    .paddingOuter(4)(root);

  const leaf = treemap.svg
    .selectAll("g.tile")
    .data(root.leaves(), (d) => d.data.name)
    .join(
      (enter) => {
        const g = enter.append("g").attr("class", "tile");
        g.append("rect")
          .attr("x", (d) => d.x0)
          .attr("y", (d) => d.y0)
          .attr("width", 0)
          .attr("height", 0)
          .attr("rx", 5)
          .attr("fill", (d) => treemapColor(d.data.slippage))
          .transition()
          .duration(300)
          .attr("width", (d) => d.x1 - d.x0)
          .attr("height", (d) => d.y1 - d.y0);

        g.append("text")
          .attr("x", (d) => d.x0 + 8)
          .attr("y", (d) => d.y0 + 18)
          .attr("fill", "#082032")
          .attr("font-size", 11)
          .attr("font-weight", 700)
          .text((d) => d.data.label);

        g.append("text")
          .attr("x", (d) => d.x0 + 8)
          .attr("y", (d) => d.y0 + 34)
          .attr("fill", "#17324d")
          .attr("font-size", 10)
          .text((d) => `${fmtInt(d.data.value)} sh`);

        return g;
      },
      (update) => {
        update
          .select("rect")
          .transition()
          .duration(300)
          .attr("x", (d) => d.x0)
          .attr("y", (d) => d.y0)
          .attr("width", (d) => Math.max(0, d.x1 - d.x0))
          .attr("height", (d) => Math.max(0, d.y1 - d.y0))
          .attr("fill", (d) => treemapColor(d.data.slippage));

        update
          .selectAll("text")
          .filter((_, i) => i === 0)
          .transition()
          .duration(300)
          .attr("x", (d) => d.x0 + 8)
          .attr("y", (d) => d.y0 + 18)
          .text((d) => d.data.label);

        update
          .selectAll("text")
          .filter((_, i) => i === 1)
          .transition()
          .duration(300)
          .attr("x", (d) => d.x0 + 8)
          .attr("y", (d) => d.y0 + 34)
          .text((d) => `${fmtInt(d.data.value)} sh`);

        return update;
      },
      (exit) => exit.remove()
    );

  leaf
    .selectAll("title")
    .data((d) => [d])
    .join("title")
    .text((d) => {
      const bps = d.data.slippage;
      return `${d.data.label}\nShares: ${fmtInt(d.data.value)}\nAvg slippage: ${fmtBps(bps)} bps`;
    });
}

function renderKpis() {
  const fills = state.fills;
  const totals = fills.reduce(
    (acc, f) => {
      acc.requested += f.requestedQty;
      acc.filled += f.fillQty;
      acc.latency += f.latencyMs;
      acc.slippage += f.slippageBps;
      return acc;
    },
    { requested: 0, filled: 0, latency: 0, slippage: 0 }
  );

  const avgLatency = fills.length ? totals.latency / fills.length : 0;
  const avgSlippage = fills.length ? totals.slippage / fills.length : 0;
  const fillRate = totals.requested ? totals.filled / totals.requested : 0;
  const activeVenues = [...state.perVenueStats.values()].filter((v) => v.fills > 0).length;

  const kpis = [
    { label: "Fill Rate", value: fmtPct(fillRate) },
    { label: "Avg Latency", value: `${avgLatency.toFixed(1)} ms` },
    { label: "Avg Slippage", value: `${fmtBps(avgSlippage)} bps` },
    { label: "Active Venues", value: `${activeVenues} / ${ROUTABLE_VENUES.length}` }
  ];

  const cards = kpiGrid.selectAll("div.kpi-card").data(kpis, (d) => d.label);

  const enter = cards
    .enter()
    .append("div")
    .attr("class", "kpi-card")
    .style("opacity", 0)
    .call((sel) => sel.transition().duration(250).style("opacity", 1));

  enter.append("p").attr("class", "kpi-label");
  enter.append("p").attr("class", "kpi-value");

  cards
    .merge(enter)
    .select(".kpi-label")
    .text((d) => d.label);

  cards
    .merge(enter)
    .select(".kpi-value")
    .text((d) => d.value)
    .attr("style", (d) =>
      d.label === "Avg Slippage" && d.value.startsWith("+")
        ? "color: #d9480f"
        : d.label === "Avg Slippage"
          ? "color: #007f5f"
          : null
    );

  cards.exit().remove();
}

function renderTape() {
  const latest = state.fills.slice(-22).reverse();

  const rows = tape.selectAll("div.fill-row").data(latest, (d) => d.id);

  const enter = rows
    .enter()
    .append("div")
    .attr("class", "fill-row")
    .style("opacity", 0)
    .call((sel) => sel.transition().duration(200).style("opacity", 1));

  enter.append("div").attr("class", "ts");
  enter.append("div").attr("class", "route");
  enter.append("div").attr("class", "qty");

  rows
    .merge(enter)
    .select(".ts")
    .text((d) => d.ts.toLocaleTimeString());

  rows
    .merge(enter)
    .select(".route")
    .html((d) => `<span class="venue">${d.side} ${d.venueLabel}</span> · ${d.orderType}`);

  rows
    .merge(enter)
    .select(".qty")
    .text((d) => `${fmtInt(d.fillQty)} @ ${fmtMoney(d.price)}`)
    .style("color", (d) => (d.side === "BUY" ? "#1450c8" : "#b33b1a"));

  rows.exit().remove();
}

function initDepth() {
  const levels = 12;
  const tick = 0.01;

  state.depth.bids = d3.range(levels).map((i) => ({
    side: "bid",
    price: state.midPrice - tick * (i + 1),
    size: randomInt(600, 4000)
  }));

  state.depth.asks = d3.range(levels).map((i) => ({
    side: "ask",
    price: state.midPrice + tick * (i + 1),
    size: randomInt(600, 4000)
  }));
}

function updateDepth() {
  state.midPrice += randomNormal(0, 0.006);

  const walk = (side, index) => {
    const shock = randomNormal(0, 220);
    const base = side.size + shock - index * 22;
    side.size = Math.round(Math.max(180, Math.min(6000, base)));
  };

  state.depth.bids.forEach((level, i) => {
    level.price = state.midPrice - 0.01 * (i + 1);
    walk(level, i);
  });

  state.depth.asks.forEach((level, i) => {
    level.price = state.midPrice + 0.01 * (i + 1);
    walk(level, i);
  });
}

function initVenueStats() {
  ROUTABLE_VENUES.forEach((v) => {
    state.perVenueStats.set(v.id, {
      shares: 0,
      fills: 0,
      requested: 0,
      slippageTotal: 0,
      latencyTotal: 0
    });
  });
}

function weightedVenuePick() {
  const r = Math.random();
  if (r < 0.2) return ROUTABLE_VENUES.find((v) => v.id === "NYSE");
  if (r < 0.39) return ROUTABLE_VENUES.find((v) => v.id === "NASDAQ");
  if (r < 0.52) return ROUTABLE_VENUES.find((v) => v.id === "IEX");
  if (r < 0.63) return ROUTABLE_VENUES.find((v) => v.id === "EDGX");
  if (r < 0.76) return ROUTABLE_VENUES.find((v) => v.id === "DARK-A");
  if (r < 0.87) return ROUTABLE_VENUES.find((v) => v.id === "DARK-B");
  if (r < 0.94) return ROUTABLE_VENUES.find((v) => v.id === "ATS-X");
  return ROUTABLE_VENUES.find((v) => v.id === "WHOLE");
}

function pickOrderType(venueType) {
  if (venueType === "dark") {
    return Math.random() > 0.45 ? "Midpoint Peg" : "Hidden Limit";
  }
  if (venueType === "wholesale") {
    return Math.random() > 0.4 ? "Retail Price Improvement" : "Internalized";
  }
  return Math.random() > 0.45 ? "Marketable Limit" : "IOC Sweep";
}

function venueLatencyBias(type) {
  if (type === "dark") return 8;
  if (type === "wholesale") return -6;
  return 0;
}

function treemapColor(slippage) {
  const clamped = Math.max(-1.8, Math.min(1.8, slippage));
  return d3.interpolateRdYlGn(1 - (clamped + 1.8) / 3.6);
}

function sourceId(link) {
  return typeof link.source === "string" ? link.source : link.source.id;
}

function targetId(link) {
  return typeof link.target === "string" ? link.target : link.target.id;
}

function dimensions(host) {
  const node = host.node();
  const box = node.getBoundingClientRect();
  return {
    width: Math.max(280, Math.floor(box.width)),
    height: Math.max(220, Math.floor(box.height))
  };
}

function handleResize() {
  if (network) {
    network.sim.stop();
    network.svg.remove();
    network = null;
  }
  if (book) {
    book.svg.remove();
    book = null;
  }
  if (treemap) {
    treemap.svg.remove();
    treemap = null;
  }

  setupNetworkViz();
  setupBookViz();
  setupTreemapViz();
  renderLinkWeights();
  renderBook();
  renderTreemap();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomNormal(mean, sd) {
  return mean + sd * d3.randomNormal.source(Math.random)(0, 1)();
}

function rollPoisson(base, spread) {
  return Math.max(1, Math.round(base + (Math.random() - 0.5) * spread * 2));
}

function debounce(fn, wait) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}
