# CK Buddy — Button Criteria

**Every button in this project MUST meet ALL of these criteria. No exceptions.**

## ③ Base Appearance
- 3D Duolingo style — pops out of the page visually
- Gradient background (lighter top → darker bottom)
- Thick bottom border (3-4px, darkest shade) acting as a depth edge
- Box shadow for floating effect
- Text shadow for label depth
- Springy transition: `all 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)`

## ① Hover (mouse over)
- **➊ Enlarge** — `translateY(-2px) scale(1.05)`, enhanced box-shadow
- **➋ Change shade darker** — background gradient shifts to a different visible shade, border color changes
- **➌ Make a noise** — 660Hz sine, 18ms, gain 0.04

## ② Click (press)
- **➊ Change shade/color** — noticeable color shift on press (whatever looks nicest for that button's palette)
- **➋ Make a different noise** — 880Hz sine, 35ms, gain 0.06
- **➌ Look compressed** — `translateY(3px) scale(0.97)`, box-shadow flattens, border-bottom shrinks from 4px to 1px — the 3D button physically pushes in

## Event Isolation (injected buttons only)
- `e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()` on click and mousedown
- Prevents host page (UWorld, AMBOSS, etc.) from intercepting

## Color Palette

| Purpose | Gradient | Border-bottom | 
|---------|----------|---------------|
| Primary | #818cf8 → #6366f1 | #3730a3 |
| Success | #34d399 → #10b981 | #065f46 |
| Warning/highlight | #fb923c → #f97316 | #9a3412 |
| Danger/close | #ef4444 → #dc2626 | #991b1b |
| Neutral | #64748b → #475569 | #334155 |

## Implementation by Context
- **popup.html/popup.js**: `btn-3d` CSS class + inline listeners
- **content.js**: call `_ckrb3dBtn(btn)` 
- **Injected via chrome.scripting**: wire all criteria manually inline
