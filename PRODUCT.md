# System Design Companion

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Candidates, interviewers, and AI agents collaborating on a system design canvas.

## Product Purpose

Create, share, sketch, inspect, and revise an architecture together using an Excalidraw canvas and MCP.

## Operating Context

Owners sign in through shared Auth to create diagrams and manage their private library. Anyone with an edit-capability share link can collaborate. Claude Code and Codex connect over MCP. Canvas menus hold sharing, versions, and the component library.

## Capabilities and Constraints

React/Vite frontend with a Cloudflare Worker, D1, R2, and Durable Objects. Keep persistence, capabilities, creation compensation, socket reconciliation, versions, and keyboard/touch behavior. Use Excalidraw components and theme tokens inside the canvas. Do not modify src/shared/route-orthogonal.ts; the benchmark baseline is frozen. Preserve public repository visibility and existing deployment/access settings.

## Brand Commitments

Keep the System Design name, purple architecture icon, and canvas as the central product.
