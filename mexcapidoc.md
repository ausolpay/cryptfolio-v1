📄 MEXC WebSocket – Trade-By-Trade Price Feed (Document for Claude Code)
1. Overview

This document explains how to connect to the new MEXC public WebSocket (v3) to receive the fastest live price updates for any cryptocurrency trading against USDT.
The method used is:

aggre.deals (trade-by-trade stream)

This stream pushes every executed trade, giving tick-level real-time price updates with latency as low as ~50–100ms.

No API key is required.

2. Why use trade-by-trade?

Fastest possible MEXC updates

Sends every trade for the selected symbol

Matches the exchange UI behaviour

Ideal for real-time price, charts, candles, and micro-movements

Works even for low-cap coins (e.g., MLUSDT)

3. WebSocket Endpoint

Use the new public WS base:

wss://wbs-api.mexc.com/ws

4. Subscription Format

To subscribe to the trade-by-trade stream:

spot@public.aggre.deals.v3.api.pb@100ms@SYMBOLUSDT


Example for Mintlayer (ML):

spot@public.aggre.deals.v3.api.pb@100ms@MLUSDT


Explanation:

spot → spot market

public.aggre.deals → aggregated trade stream

v3.api.pb → new Protobuf-based v3 API

100ms → update interval

MLUSDT → trading pair symbol

5. Full WebSocket Subscribe Message (JSON)
{
  "method": "SUBSCRIPTION",
  "params": [
    "spot@public.aggre.deals.v3.api.pb@100ms@MLUSDT"
  ]
}

6. Minimal JavaScript Example
// Connect to the new MEXC WebSocket
const ws = new WebSocket("wss://wbs-api.mexc.com/ws");

ws.onopen = () => {
  console.log("Connected to MEXC WebSocket");

  // Subscribe to MLUSDT trade-by-trade stream
  ws.send(JSON.stringify({
    method: "SUBSCRIPTION",
    params: [
      "spot@public.aggre.deals.v3.api.pb@100ms@MLUSDT"
    ]
  }));
};

// Handle incoming messages
ws.onmessage = (message) => {
  const data = JSON.parse(message.data);

  // Check for trade stream updates
  if (data.channel === "spot@public.aggre.deals.v3.api.pb") {
    const trade = data.data;
    
    // Extract the live price
    const livePrice = trade.price;
    
    console.log("LIVE TRADE PRICE:", livePrice);

    // trade.side = buy/sell
    // trade.volume = amount traded
    // trade.ts = timestamp
  }
};


This JS code:

Connects to MEXC

Subscribes to trade-by-trade

Logs every real trade instantly

Gives the fastest and most responsive price data

7. Key Notes for Claude Code

No API key is required for public streams.

The symbol must be fully uppercase (e.g., MLUSDT).

The aggre.deals channel is the fastest and should be used for real-time price.

If the UI is not updating, check symbol mapping or rounding logic, not the WebSocket.

This documentation can be used to generate the full integration code inside an app.

8. One-Sentence Summary (Claude-friendly)

Use the MEXC public WebSocket endpoint wss://wbs-api.mexc.com/ws and subscribe to spot@public.aggre.deals.v3.api.pb@100ms@MLUSDT to receive every real trade and get the fastest live price updates for any USDT pair.