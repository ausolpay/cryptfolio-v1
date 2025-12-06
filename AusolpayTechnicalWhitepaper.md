AUSOLPAY (ASOL) — TECHNICAL IMPLEMENTATION & PROTOCOL SPECIFICATION

Version: 1.0
Audience: Blockchain Engineers, Smart Contract Developers, Auditors

1. SYSTEM OVERVIEW (IMPLEMENTATION PERSPECTIVE)

AusolPay is a multi-contract payment ecosystem composed of:

ASOL – SPL utility token (deflationary, stakeable)

AUSD – fully collateralised stablecoin pegged to AUD

ARC – reserve/stabilisation asset

Presale Program – manages token sale & vesting

Staking Program – manages locked staking + rewards

Treasury Program – manages reserves, revenues

Buyback & Burn Program – algorithmic, autonomous

Payment Router Program – ASOL → AUSD conversion

Airdrop Program – conditional distribution (CryptFolio)

Off-chain Services – price feeds, treasury reporting

All on-chain logic is built using:

Solana

Rust

Anchor framework

SPL Token / Token-2022

2. TOKEN DEFINITIONS (ON-CHAIN)
2.1 ASOL (Utility Token)
Property	Value
Token Standard	SPL Token
Decimals	9
Total Supply	1,000,000,000 ASOL
Mint Authority	Governance PDA (later)
Burn Authority	Buyback PDA only

Key behaviours:

Transferable

Stakeable

Subject to burn

Used in payments

Used in governance (future)

2.2 AUSD (Stablecoin)
Property	Value
Peg	1.00 AUD
Supply	Elastic (mint/burn)
Backing	Treasury reserves
Burns	❌ No
Buybacks	❌ No

AUSD must never:

Inflate without backing

Burn speculatively

Be subject to market buybacks

AUSD minting is strictly controlled by the treasury contract, not arbitrary calls.

2.3 ARC (Reserve Currency)

ARC is used as:

Secondary stabilisation asset

Emergency buffer

Peg-support instrument

ARC mechanics can be implemented later; initially it exists as a supply-locked reserve token.

3. PRESALE PROGRAM (CORE IMPLEMENTATION)
3.1 Presale Parameters

Total Presale Tokens: 300,000,000 ASOL

Stages: 10 (all public)

Tokens per stage: 30,000,000 ASOL

Decimal handling: 9 decimals

3.2 Stage Pricing (Accelerating)
Stage	Price (AUD)
1	0.010
2	0.015
3	0.020
4	0.025
5	0.030
6	0.040
7	0.050
8	0.065
9	0.080
10	0.100

Launch price target: 0.120 AUD

3.3 Presale Program Responsibilities

The presale program MUST:

✅ Accept SOL
✅ Convert SOL → AUD value (oracle/off-chain feed)
✅ Calculate ASOL allocation per stage
✅ Track per-wallet vesting state
✅ Enforce staged progression
✅ Prevent overselling
✅ Lock unvested supply
✅ Allow only claimable token withdrawals

3.4 Vesting Logic (Critical)

For every buyer:

10% unlocked at TGE

10% unlocked per calendar month for 9 months

Total vesting duration: 10 months

Required On-Chain State Per Wallet
struct VestingAccount {
    owner: Pubkey,
    total_purchased: u64,
    claimed_amount: u64,
    start_timestamp: i64,
}


Claim calculation formula:

months_elapsed = floor((current_time - start_time) / 30 days)
unlock_percent = min(1 + months_elapsed, 10) * 10%
claimable = total * unlock_percent - claimed_amount


Claims must revert if claimable <= 0.

4. STAKING PROGRAM
4.1 Purpose

Lock ASOL

Reduce circulating supply

Reward long-term holders

Secure economic stability

4.2 Staking Pools

Multiple pools with fixed lock durations:

Lock Period	Multiplier
3 months	1.0×
6 months	1.3×
12 months	1.7×
24 months	2.2×
4.3 24-Month Reward Vesting (VERY IMPORTANT)

Rewards do not unlock immediately.

Rewards are locked for 24 months

After 24 months, rewards unlock linearly over 12 months

This requires separate accounting:

struct StakingReward {
    accrued: u64,
    locked_until: i64,
    claimed: u64,
}


This prevents:

Yield farming abuse

Dump pressure

Short-term exploitation

5. AIRDROP PROGRAM (INCLUDING CRYPTFOLIO)
5.1 Airdrop Allocation

20,000,000 ASOL total

5.2 Eligibility Conditions

Airdrops are conditional, not random.

Eligible users:

Register Solana wallet in CryptFolio App

Maintain wallet linkage

Participate in ecosystem usage

Possibly stake / transact

5.3 Airdrop Claim Logic

Airdrops can be:

Immediate unlock

Or linear unlock (recommended)

Airdrop accounts should track:

struct AirdropAccount {
    owner: Pubkey,
    amount: u64,
    claimed: bool,
}

6. PAYMENT ROUTER (ASOL → AUSD)
6.1 Purpose

Merchants never hold volatile ASOL.

6.2 Flow

Customer pays ASOL

Amount routed to payment program

ASOL split:

Portion → burn

Portion → treasury

Portion → liquidity (optional)

Merchant receives AUSD

Rate determined via oracle/AUD reference

This must be atomic.

6.3 Failure Conditions

Oracle unavailable → halt payments

Peg instability → halt route

Treasury imbalance → fallback logic

7. TREASURY PROGRAM
7.1 Treasury Controls

Treasury must maintain:

AUSD collateral

Operational funds

Buyback reserves

Treasury is the ONLY entity allowed to:

Mint AUSD

Fund buybacks

Allocate reserves

Treasury calls must be PDA-restricted.

8. BUYBACK & BURN PROGRAM (ASOL ONLY)
8.1 Principles

Purely algorithmic

No governance intervention

No human triggers

Extremely conservative

8.2 Funding Rule

Buybacks use maximum 1–3% of net revenue, only if:

✅ Treasury runway ≥ 18 months
✅ AUSD peg stable
✅ Liquidity above threshold
✅ Volatility low
✅ Revenue positive

8.3 Execution Rules

Use TWAP pricing

Execute micro-orders

Randomised intervals

Max buyback = 0.2% daily volume

8.4 Burn Execution

All bought ASOL sent to:

11111111111111111111111111111111


No exceptions.

9. SECURITY REQUIREMENTS
Mandatory Safeguards

PDA authority everywhere

Reentrancy protection

Arithmetic overflow checks

Time-based unlocking enforcement

Admin functions disabled post-deploy

Circuit breakers for treasury/payouts

10. ORACLE & OFF-CHAIN REQUIREMENTS

SOL/AUD feed

ASOL price reference

Treasury health maths (off-chain analytics)

Monthly reporting service

11. DEPLOYMENT PHASES
Phase 1

ASOL mint

Presale program

Vesting logic

Phase 2

Staking program

Treasury contracts

Phase 3

Payment router

AUSD issuance

Buyback/burn

Phase 4

CryptFolio integration

Merchant APIs

NFC payments

12. AUDIT NOTES (FOR AUDITORS)

Auditors should focus on:

Vesting correctness

Treasury authority boundaries

Burn irreversibility

AUSD supply backing invariants

Buyback guards

Time manipulation risks

13. SUMMARY FOR IMPLEMENTERS

If built correctly, AusolPay achieves:

✅ Low-fee commerce
✅ Stable merchant settlement
✅ Controlled inflation
✅ Long-term scarcity
✅ Abuse-resistant staking
✅ Regulatory-friendly stablecoin
✅ Sustainable token value