# Documentation Organization

This document explains how the documentation is organized and where to find specific information.

## 📁 Directory Structure

```
docs/
├── README.md                    # Main project documentation (English)
├── README_zh.md                 # Main project documentation (Chinese)
├── CLAUDE.md                    # Claude Code guidance for developers
├── INDEX.md                     # Complete documentation index
├── ORGANIZATION.md              # This file - explains the structure
│
├── guides/                      # 📖 Step-by-step guides
│   ├── README.md               # Guides overview
│   ├── API_KEY_POOL_GUIDE.md   # API Key Pool complete guide
│   ├── CACHE_*.md              # Cache system guides (3 files)
│   ├── SHIN_MODE_GUIDE.md      # Sequential processing guide
│   ├── CLEANUP_GUIDE.md        # Resource cleanup guide
│   └── *_QUICK_REFERENCE.md    # Quick reference cards (2 files)
│
├── features/                    # ✨ Feature descriptions
│   ├── README.md               # Features overview
│   ├── README_CACHE.md         # Cache system overview
│   ├── CACHE_FEATURE_SUMMARY.md # Cache implementation summary
│   ├── DASHBOARD_FEATURES.md   # Dashboard features
│   ├── UNIVERSAL_TRACKING_SYSTEM.md # Token tracking
│   ├── PERFORMANCE_ENHANCEMENT_PROPOSAL.md # Enhancement proposals
│   └── PROXY_UPGRADE_RECOMMENDATIONS.md # Infrastructure upgrades
│
├── implementation/              # 🔧 Technical implementation
│   ├── README.md               # Implementation overview
│   ├── *_IMPLEMENTATION_COMPLETE.md # Completed features (2 files)
│   ├── IMPLEMENTATION_CHECKLIST.md  # Cache checklist
│   └── IMPLEMENTATION_SUMMARY.txt   # Overall summary
│
├── summaries/                   # 📊 Reports and summaries
│   ├── README.md               # Summaries overview
│   ├── BUGFIX_SUMMARY.md       # Bug fixes summary
│   ├── ENHANCEMENT_SUMMARY.md  # Enhancements summary
│   ├── METRICS_*.md            # Metrics-related reports (5 files)
│   └── NVIDIA_METRICS_FIX.md   # NVIDIA-specific fix
│
├── blog/                        # 📝 Technical articles
│   ├── README.md               # Blog overview
│   ├── en/                     # English articles (2 posts)
│   ├── zh/                     # Chinese articles (2 posts)
│   └── images/                 # Blog images and diagrams
│
└── ui/                          # 🎨 UI project documentation
    ├── README.md               # UI project overview (from template)
    ├── CLAUDE.md               # Claude Code guidance for UI
    └── PROJECT.md              # UI project guide (Chinese)
```

## 🎯 How to Find What You Need

### I want to...

#### Get Started
- **Learn what this project is**: [README.md](README.md) or [README_zh.md](README_zh.md)
- **See all documentation**: [INDEX.md](INDEX.md)
- **Quick start with cache**: [guides/CACHE_QUICK_START.md](guides/CACHE_QUICK_START.md)

#### Understand Features
- **See all features**: [features/README.md](features/README.md)
- **Learn about caching**: [features/README_CACHE.md](features/README_CACHE.md)
- **Understand metrics dashboard**: [features/DASHBOARD_FEATURES.md](features/DASHBOARD_FEATURES.md)
- **Learn about token tracking**: [features/UNIVERSAL_TRACKING_SYSTEM.md](features/UNIVERSAL_TRACKING_SYSTEM.md)

#### Learn How to Use
- **API Key Pool**: [guides/API_KEY_POOL_GUIDE.md](guides/API_KEY_POOL_GUIDE.md)
- **Cache System**: [guides/CACHE_IMPLEMENTATION_GUIDE.md](guides/CACHE_IMPLEMENTATION_GUIDE.md)
- **Shin Mode**: [guides/SHIN_MODE_GUIDE.md](guides/SHIN_MODE_GUIDE.md)
- **Metrics**: [guides/METRICS_QUICK_REFERENCE.md](guides/METRICS_QUICK_REFERENCE.md)

#### Understand Implementation
- **See implementation details**: [implementation/README.md](implementation/README.md)
- **API Key Pool implementation**: [implementation/API_KEY_POOL_IMPLEMENTATION_COMPLETE.md](implementation/API_KEY_POOL_IMPLEMENTATION_COMPLETE.md)
- **Shin Mode implementation**: [implementation/SHIN_MODE_IMPLEMENTATION_COMPLETE.md](implementation/SHIN_MODE_IMPLEMENTATION_COMPLETE.md)
- **Check implementation status**: [implementation/IMPLEMENTATION_SUMMARY.txt](implementation/IMPLEMENTATION_SUMMARY.txt)

#### Track Changes and Fixes
- **See bug fixes**: [summaries/BUGFIX_SUMMARY.md](summaries/BUGFIX_SUMMARY.md)
- **See enhancements**: [summaries/ENHANCEMENT_SUMMARY.md](summaries/ENHANCEMENT_SUMMARY.md)
- **Check completion status**: [summaries/METRICS_COMPLETION_REPORT.md](summaries/METRICS_COMPLETION_REPORT.md)
- **Upgrade the metrics system**: [summaries/METRICS_UPGRADE_CHECKLIST.md](summaries/METRICS_UPGRADE_CHECKLIST.md)

#### Read In-Depth Articles
- **Project motivation (English)**: [blog/en/project-motivation-and-how-it-works.md](blog/en/project-motivation-and-how-it-works.md)
- **Router capabilities (English)**: [blog/en/maybe-we-can-do-more-with-the-route.md](blog/en/maybe-we-can-do-more-with-the-route.md)
- **项目动机 (中文)**: [blog/zh/项目初衷及原理.md](blog/zh/项目初衷及原理.md)
- **路由器功能 (中文)**: [blog/zh/或许我们能在Router中做更多事情.md](blog/zh/或许我们能在Router中做更多事情.md)

#### Work on the UI
- **UI overview**: [ui/README.md](ui/README.md)
- **Development guidance**: [ui/CLAUDE.md](ui/CLAUDE.md)
- **项目指南**: [ui/PROJECT.md](ui/PROJECT.md)

## 📚 Documentation Categories

### By Purpose

| Category | Description | Location |
|----------|-------------|----------|
| **Getting Started** | Installation, configuration, basic usage | [README.md](README.md) |
| **Guides** | Step-by-step tutorials | [guides/](guides/) |
| **Features** | What the system can do | [features/](features/) |
| **Implementation** | How it's built | [implementation/](implementation/) |
| **Changes** | What's been fixed/improved | [summaries/](summaries/) |
| **Deep Dives** | Technical articles | [blog/](blog/) |
| **UI** | Frontend documentation | [ui/](ui/) |

### By Topic

| Topic | Relevant Documents |
|-------|-------------------|
| **Caching** | guides/CACHE_*.md, features/CACHE_*.md, features/README_CACHE.md |
| **API Keys** | guides/API_KEY_POOL_GUIDE.md, implementation/API_KEY_POOL_IMPLEMENTATION_COMPLETE.md |
| **Metrics** | guides/METRICS_*.md, features/DASHBOARD_FEATURES.md, summaries/METRICS_*.md |
| **Shin Mode** | guides/SHIN_MODE_GUIDE.md, implementation/SHIN_MODE_IMPLEMENTATION_COMPLETE.md |
| **Token Tracking** | features/UNIVERSAL_TRACKING_SYSTEM.md, summaries/NVIDIA_METRICS_FIX.md |
| **Performance** | features/PERFORMANCE_ENHANCEMENT_PROPOSAL.md, features/PROXY_UPGRADE_RECOMMENDATIONS.md |

### By Language

| Language | Documents |
|----------|-----------|
| **English** | All guides/, features/, implementation/, summaries/, blog/en/ |
| **Chinese (中文)** | README_zh.md, blog/zh/, ui/PROJECT.md |
| **Both** | Most technical content has concepts that transcend language |

## 🔍 Search Tips

### Find by Filename Pattern
```bash
# Find all cache-related docs
find docs -name "*CACHE*"

# Find all guides
ls docs/guides/

# Find all summaries
ls docs/summaries/
```

### Find by Content
```bash
# Search for a topic across all docs
grep -r "API key pool" docs/

# Search in specific category
grep -r "metrics" docs/guides/
```

## 📝 Documentation Standards

### File Naming
- `README.md` - Overview of directory or main documentation
- `*_GUIDE.md` - Step-by-step tutorials
- `*_SUMMARY.md` - Summary reports
- `*_COMPLETE.md` - Completion status documents
- `*_CHECKLIST.md` - Implementation/upgrade checklists
- `*_REFERENCE.md` - Quick reference cards
- `*_PROPOSAL.md` - Feature proposals

### Organization Principles
1. **Category-based folders** - Group by document purpose
2. **README in each folder** - Quick navigation
3. **Consistent naming** - Easy to find related docs
4. **Cross-references** - Links between related docs
5. **Language separation** - English and Chinese clearly separated

## 🔄 Maintenance

### Adding New Documentation
1. Determine the category (guide, feature, implementation, etc.)
2. Place in appropriate folder
3. Update the folder's README.md
4. Add entry to [INDEX.md](INDEX.md)
5. Add cross-references from related docs

### Updating Existing Documentation
1. Update the document
2. Update last modified date if present
3. Update related documents if needed
4. Keep cross-references current

---

**Need help navigating?** Start with [INDEX.md](INDEX.md) for a complete list of all documentation.

[← Back to Documentation Index](INDEX.md)
