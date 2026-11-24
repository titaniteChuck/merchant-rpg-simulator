---
type: Review
title: Live site review R1
description: Findings from an agent review of the live site (2026-11-24, deploy b9e7cac), prioritised, with what is already covered by work in progress.
timestamp: 2026-11-24
---

# Live site review R1

[Root](../../index.md) > [Tooling](../index.md) > [Roadmap](./index.md) > Live site review R1

## Table of contents

- [Scope](#scope)
- [Top findings](#top-findings)
- [Other findings](#other-findings)
- [Already covered](#already-covered)

## Scope

Live deploy of `b9e7cac`; home, save viewer, hero page, battle (all modes), wiki. Frozen pages (Profit, Farming,
Levelling, Balance) excluded. 1280/375, dark/light, EN/FR, with/without the example save and expansions. No console
errors, no 404s, keyboard and focus OK; one page overflow (F16). Screenshots stay local (agent scratchpad).

## Top findings

| Id | Kind | Page | Finding | Status |
|---|---|---|---|---|
| F01 | bug, high | battle | Opponent resets to Forest Gathering after reload; the kept party then breaks the solo rule | U36 (opponent remembered) |
| F02 | improvement, high | battle | Fresh save: empty party vs a 1-HP bush, a red warning before any action; start from a useful quest with a party | Backlog |
| F03 | bug | wiki enemy | XP block grade/party reset on language change | Backlog |
| F04 | visual | Treasure Bush, Archon | XP table capped at 720 px, XP/min column cut | Backlog |
| F05 | visual | grade badges | White D/C/B/A badges fail WCAG AA (3.2–4.5) | Backlog |
| F06 | bug | battle map run | 0% wins still shows XP per hero and XP/min | Backlog |
| F07 | bug | Minor Potion | Recipe says "0 min" (15 s) | Backlog |
| F08 | bug | wiki home | Enemies card says gathering quests are left out; they are listed | Backlog |
| F09 | inconsistency | top bar | Save chip vs Expansions button differ by page; order differs | U35 (menus) |
| F10 | visual | top bar at 375 | Only 1–2 links fit | U35 (drawer) |
| F11 | inconsistency | wiki, battle | Rare variants named three ways | Backlog |
| F12 | inconsistency | save vs battle | Map names "Deadly Grimhal Map" vs "Grimhal Map (Deadly)" | Partly U36 (modded names on battle) |
| F13 | inconsistency | tables | Header styles differ (small caps vs bold Title case) | Backlog |
| F16 | visual | FR map pages | Essence label overflows its card | Backlog |
| F20 | improvement | battle | Too much explanatory text | Partly U36 |

## Other findings

Medium: F15 empty Maps list without expansions ("0 of 0", stray icons); F18 lead lines repeat the cards; F19 tall bush
cards; F23 potion mode lists +0.0 rows (mode removed in U36).
Low: F14 XP table numbers right-aligned; F17 raw map lead text names the wrong boss; F21 raw plan scores (removed in U36);
F22 damage/fight counts overkill; F24 FR party warning in English; F25 Battle page uses a text pill not the quill icon;
F26 Expansions tab has a title/intro, emoji before some titles; F27 three toggle styles; F28 "g" and time formats
inconsistent; F29 "Rooms 9" vs "of 11.1 rooms"; F30 item type capitalisation; F31 hidden-page text assumes the save set
ownership; F32 identical "Available" badges, card order vs menu; F33 unused skills listed, empty "Enemies (0)";
F34 no skip link (25 tab stops); F35 lone last-row cards; F36 Clear all enabled when empty, "Up to ×1" before heroes;
F37 AP shown three times, "× 2.00×"; F38 save-location help differs between pages; F39 Forest Essence rarity colour and
region note; F40 mixed languages in FR; F41 map-only enemies repeat "map boss", "Party 6 heroes" on a bush;
F42 Archon XP lists 1 map vs 6, level-70 maps silently dropped; F43 sell value base rounded (18 g vs 15–20);
F44 bush drops "leaves" vs "mosses and roots"; F45 tall save menu, Expansions page re-explains its switches.

## Already covered

F01, F09, F10, F12 (battle part), F20 (part), F21, F23, F35 (Optimise) by U35/U36 in progress. Everything else is a
backlog for the user to prioritise.
