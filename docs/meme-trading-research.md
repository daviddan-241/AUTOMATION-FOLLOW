# Professional Meme-Coin Trading Filters & Strategy Guide for pump.fun (Solana)

## Executive Summary
Upgrading an automated trading bot on pump.fun from simple heuristics (e.g., "buy anything that doubles in 30 minutes") to professional-grade trading requires shifting from lagging price signals to real-time microstructural filters. On pump.fun, over 97% of launched tokens fail to complete their bonding curve. The average lifespan of a non-graduating token is under 5 minutes. 

To achieve profitability, professional meme-coin traders (using terminals like GMGN.ai, Photon SOL, BullX, and Axiom Pro) combine **strict quantitative entry filters**, **negative rug detection filters**, **fast automated partial take-profit laddering**, and **multi-tiered data pipelines** (Solana RPCs, PumpPortal WebSockets, and third-party security APIs like RugCheck).

---

## 1. Concrete Buy-Side Professional Filters & Numeric Thresholds

### 1.1 Developer Holding Percentage
* **Threshold**: Maximum **< 3% to < 5%** of total token supply held by the developer wallet at purchase time. Ideal: **0% - 1%** (dev has already sold their initial allocation or burned it).
* **Hard Disqualifier**: Any token where the dev holds **> 5% - 10%** of total supply.
* **Trader Rationale**: Devs holding large supply chunks can single-handedly collapse the bonding curve by dumping into liquidity.

### 1.2 Top-10 Holder Concentration
* **Threshold**: Maximum **< 15% - 20%** combined supply across the top 10 non-bonding-curve token accounts.
* **Calculation**:
  $$\text{Top10 Concentration \%} = \frac{\sum_{i=1}^{10} \text{Balance}(\text{Holder}_i)}{\text{Total Supply} - \text{Bonding Curve Balance}} \times 100\%$$
* **Hard Disqualifier**: Top 10 holders control **> 25% - 30%** of supply.
* **Trader Rationale**: High concentration indicates whale/insider dominance, making the token vulnerable to coordinated dumps ("group rugs").

### 1.3 Bundled & Sniped Supply
* **Threshold**: Total sniped/bundled supply in Block 0/Slot 0 must be **< 10% - 15%** of total supply. No single bundle wallet should hold **> 3% - 5%**.
* **Detection Mechanism**: Identifies atomic Jito transactions or multi-wallet buys originating from a single SOL funder wallet in the token's creation transaction or block 0.
* **Hard Disqualifier**: Combined bundle/sniper holdings exceeding **15% - 20%**.

### 1.4 Holder Count & Buyer Velocity
* **Minimum Thresholds**:
  * **Early Stage (0% - 30% Bonding Curve)**: Minimum **25 - 50 unique non-bundled wallets**.
  * **Mid Stage (30% - 70% Bonding Curve)**: Minimum **80 - 150 unique wallets**.
* **Buyer Velocity**: Minimum **5 - 10 unique buyers per minute**.
* **Organic Buyer Ratio**: **> 75%** of transactions must originate from distinct funding sources (not funded by the dev or a common wallet).

### 1.5 Volume-to-Market Cap Ratio
* **Threshold**: 5-minute Volume / Market Cap ratio **> 0.30 - 0.50**.
* **Trader Rationale**: High volume relative to market cap signals active price discovery and interest. Low volume on a rising market cap signals low-liquidity manipulation.

### 1.6 Bonding Curve Progress & Entry Zones
pump.fun uses a constant-product virtual bonding curve ($k = x \cdot y$) targeting **85 SOL** (or ~$69,000 USD virtual market cap at $140 SOL) for graduation to Raydium/PumpSwap.

$$\text{Bonding Curve Progress \%} = \frac{\text{realSolReserves}}{\text{targetSol (85 SOL)}} \times 100\%$$

* **Zone 1: Early Sniper (High Risk / High Reward)**: **10% - 25% Progress** ($7k - $18k MCap). Requires 0% dev holding and 0 bundle flags.
* **Zone 2: Momentum Sweet Spot (Recommended)**: **45% - 75% Progress** ($30k - $52k MCap). Proven holder distribution, strong volume, high likelihood of push to graduation.
* **Zone 3: Pre-Graduation Front-Run**: **85% - 95% Progress** ($58k - $65k MCap). Traders position for the liquidity migration pump into DEX pools.

### 1.7 Social & Metadata Quality
* **Required Links**: Presence of valid **Twitter/X**, **Telegram**, and **Website** metadata in the token payload.
* **Velocity/Quality Check**: Token must have image + custom description (not generic boilerplate).
* **Twitter Quality Filter**: Exclude tokens linking to Twitter accounts created on the same day or with < 50 followers (signals low-effort deployer farm).

### 1.8 Liquidity Migration & DEX Status
* **Flags**: Track `complete` status on bonding curve account.
* **Post-Graduation Rule**: Verify liquidity pool completion (`raydium_pool_complete` or PumpSwap pool creation) and confirm LP tokens are burned/locked.

---

## 2. Rug & Sell Warning Signs (Instant Negative Disqualifiers)

1. **Dev Selling / Dumping**: Instant disqualification if dev sells any portion of their supply (> 0.5%) within the first 5 minutes.
2. **Bundled Buys & Wallet Clustering**: Multiple top wallets funded by the exact same CEX withdrawal or SOL dispenser wallet within minutes of creation.
3. **Serial Dev Deployer**: Dev wallet has launched > 2 tokens in the past 24 hours that all reached 0% within 10 minutes.
4. **Clone Deployments**: Token ticker/name or metadata image matches a token deployed within the last 1 hour.
5. **Wash Trading / Artificial Volume**: High transaction count (> 100 txs) but low unique buyers (< 15 unique wallets), indicating 1-2 wallets trading back and forth to spoof volume filters.
6. **Freeze / Mint Authority Risk**: Spl-token extensions with unrenounced mint or freeze authority (Standard pump.fun SPL tokens automatically renounce these, but custom contracts outside standard bonding curves may retain them).

---

## 3. Take-Profit (TP) & Stop-Loss (SL) Mechanics for pump.fun

Because pump.fun tokens move extremely fast and 97%+ fail, static DCA or slow limit orders fail. Professionals use **automated partial-exit laddering** with high priority fees.

### 3.1 Exit Execution Parameters
* **Slippage Tolerance**: Set to **10% - 25%** to prevent failed transactions during high volatility.
* **Priority Fees / Tips**: Use Jito tips (**0.002 - 0.01 SOL**) or RPC priority fees to ensure immediate block inclusion during dumps.

### 3.2 Standard Partial Take-Profit (TP) Ladder

| Exit Tier | Trigger (Price / MCap) | Position Sold | Strategy / Purpose |
| :--- | :--- | :--- | :--- |
| **TP 1** | **+50% to +100% (1.5x - 2.0x)** | **50% of position** | **Risk-Free Entry**: Recovers 100% of initial SOL capital. |
| **TP 2** | **+150% to +200% (2.5x - 3.0x)** | **25% of position** | **Lock Profit**: Secures guaranteed net profit. |
| **TP 3** | **Bonding Graduation (85%-95%)** | **15% of position** | **Graduation Push**: Exit before post-migration DEX selloff. |
| **Moonbag**| **Trailing Stop / DEX Listing** | **10% of position** | **Runner**: Let run for potential multi-million MCap breakout. |

### 3.3 Stop-Loss (SL) Rules
* **Hard Price Stop-Loss**: **-15% to -25%** from entry price.
* **Trailing Stop-Loss**: Peak price minus **15% - 20%** once position is in profit.
* **Dev Dump Panic Stop**: Instant **100% market sell** if dev wallet token balance decreases.
* **Time-Based Stagnation Exit**: If bonding curve progress does not advance by at least **+5% within 3 minutes**, exit at market price.

---

## 4. Technical Data Sourcing & API/RPC Matrix

| Metric | Source | Technical Endpoint / Method | Availability / Cost |
| :--- | :--- | :--- | :--- |
| **New Token Creation & Metadata** | PumpPortal WebSocket / RPC | `wss://pumpportal.fun/api/data` (`subscribeNewToken`) | Free / Public |
| **Bonding Curve State (Sol/Token Reserves)** | Solana RPC / Account Data | `getAccountInfo` for Bonding Curve Account | Free Public RPC |
| **Dev Token Balance** | Solana RPC | `getTokenAccountsByOwner(dev_address, mint)` | Free Public RPC |
| **Top 10 Holder Balances** | Solana RPC | `getTokenLargestAccounts(mint)` | Free Public RPC |
| **Dev Wallet SOL Balance** | Solana RPC | `getBalance(dev_address)` | Free Public RPC |
| **Token Safety / Risk Score** | RugCheck API | `GET https://api.rugcheck.xyz/v1/tokens/{mint}/report` | Free API |
| **Bundle & Sniper Detection** | Helius / GMGN / Custom Indexer | RPC Transaction Parsing (Block 0 Jito bundle evaluation) | Paid / Specialized Indexer |
| **Dev Past Launch Win-Rate** | GMGN / Solscan / Custom DB | Historical transaction indexing by creator wallet | Specialized Indexer |

---

## 5. Implementation Roadmap for Bot Upgrade

```
                        [ New pump.fun Token Launch Event ]
                                        │
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │  Filter 1: Metadata & Social Check      │
                   │  - Has Twitter / Telegram / Website?    │
                   │  - Not a clone image/ticker?            │
                   └───────────────────┬─────────────────────┘
                                       │ Pass
                                       ▼
                   ┌─────────────────────────────────────────┐
                   │  Filter 2: Dev & Supply Safety Check    │
                   │  - Dev Holding < 3%?                    │
                   │  - Top-10 Holders < 20%?                │
                   │  - RugCheck Score == Good/Single Risk?  │
                   └───────────────────┬─────────────────────┘
                                       │ Pass
                                       ▼
                   ┌─────────────────────────────────────────┐
                   │  Filter 3: Volume & Velocity Check      │
                   │  - Bonding Curve between 45% - 75%?     │
                   │  - Unique Holders > 50?                 │
                   │  - 5-min Vol / MCap > 0.35?             │
                   └───────────────────┬─────────────────────┘
                                       │ Pass
                                       ▼
                             [ EXECUTE BUY ORDER ]
                                       │
                                       ▼
               ┌─────────────────────────────────────────────────┐
               │         POSITION MANAGEMENT & MONITORING        │
               ├─────────────────────────────────────────────────┤
               │ 1. TP 1: Sell 50% at +50% ROI (Free Roll)       │
               │ 2. TP 2: Sell 25% at +150% ROI                  │
               │ 3. SL Hard: Exit 100% at -20%                    │
               │ 4. Dev Dump Trigger: Exit 100% if dev sells      │
               │ 5. Stagnation: Exit 100% if no growth in 3 mins │
               └─────────────────────────────────────────────────┘
```

---
*Research compiled for Solana pump.fun trading bot automation.*
