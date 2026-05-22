# Execution Flow Visualizer (D3.js)

An interactive market microstructure dashboard that makes order routing and fill quality visible.

This project simulates retail-order execution across lit venues, dark pools, ATSs, and wholesalers, then visualizes:
- Routing topology with live animated fills
- Depth-of-book updates around a moving midpoint
- Venue allocation concentration via treemap
- Session-level execution KPIs (fill rate, latency, slippage)

## Why This Is Resume-Ready

Most educational trading tools only show whether orders filled. This project demonstrates **where and how** they filled, plus execution-quality metrics relevant to Transaction Cost Analysis (TCA).

It showcases D3 capabilities that charting wrappers typically do not:
- Force simulation with custom SVG graph rendering
- Animated flow particles over live topology
- Frequent enter/update/exit cycles under high event throughput
- Multiple coordinated views fed by a shared execution state

## Features

1. **Execution Routing Graph**
- Force-directed venue map (`OMS -> SOR -> destination venues`)
- Link widths scale with routed share volume
- Node categories by venue type (lit/dark/wholesale/router)

2. **Animated Fill Streams**
- Every synthetic fill emits an animated particle from router to venue
- Particle size reflects fill quantity
- Side-aware color coding (`BUY` vs `SELL`)

3. **Live Depth-of-Book Panel**
- Two-sided book with bid/ask size bars around a moving midpoint
- Real-time level-size and price updates
- Top-of-book readout for immediate context

4. **Allocation Treemap**
- Share-weighted venue allocation visualization
- Tile color reflects average venue slippage
- Live resizing as venue participation shifts

5. **Execution KPI Strip**
- Fill rate
- Average latency
- Average slippage (bps)
- Active venues count

## Tech Stack

- **D3.js v7**
- Vanilla JavaScript (ES Modules)
- HTML/CSS (responsive layout)

## Project Structure

- `index.html` - app shell and dashboard layout
- `styles.css` - visual system and responsive design
- `src/main.js` - simulation engine and all D3 render/update logic

## Run Locally

Use any static server from the project directory.

```bash
python3 -m http.server 8080
```

Then open:

- [http://localhost:8080](http://localhost:8080)

## Recruiter-Facing Talking Points

- Built a D3-based execution-monitoring dashboard to expose market microstructure (routing, venue allocation, and live order-book context) for retail-order flow simulation.
- Implemented custom SVG rendering and animation pipelines (force graph, animated route particles, treemap, and streaming depth panel) with high-frequency enter/update/exit updates.
- Modeled realistic execution metrics (fill rate, latency, slippage in bps) to mirror commercial execution-quality and TCA workflows.

## Next Extensions (Optional)

- WebSocket ingest from real or replayed market data
- Symbol switching and session replay scrubber
- Venue-level adverse selection and markout analytics
- Exportable TCA report snapshots
