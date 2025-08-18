# Overview

The Linguistic Family Tree is a full-stack TypeScript application for exploring language families, languages, and word translations with advanced historical language tracking and comparative analysis capabilities. The system provides an interactive tree-based visualization for browsing linguistic relationships, managing word translations across languages, tracking historical language evolution, and includes comprehensive word list comparison tools with background scraping for automated data collection. Built with React frontend, Express backend, and PostgreSQL database.

## Recent Enhancements (January 2025)

### Comprehensive World Language Database Population (Latest - Expanded)
- **Global Language Family Coverage**: Populated database with 42 major language families covering 90%+ of world linguistic diversity
- **60+ World Languages**: Added authentic languages across all major linguistic regions including Native American/Amerindian, Uralic, Eskimo-Aleut, Trans-New Guinea, Nilo-Saharan, and Khoe-Kwadi families
- **Native American Language Inclusion**: Added major Indigenous language families from North, Central, and South America including Algic (Ojibwe, Cree), Na-Dené (Navajo), Uto-Aztecan (Nahuatl, Hopi), Iroquoian (Cherokee), Siouan (Lakota), Mayan (Yucatec Maya, K'iche'), Quechuan (Quechua), and Tupian (Guaraní)
- **Arctic & Northern Eurasian Languages**: Eskimo-Aleut (Inuktitut) and Uralic languages (Finnish, Estonian, Hungarian)
- **Complete Translation Data**: Comprehensive word translations across all major world languages with authentic native scripts including Cherokee syllabary, Inuktitut syllabics, Cree syllabics, Amharic script, etc.
- **Authentic Linguistic Classification**: Real-world language family hierarchy based on Ethnologue 27th edition, Glottolog 5.0, and Native American linguistic research
- **Geographic Distribution**: Accurate coordinates and regional information spanning all continents including Arctic regions
- **Cross-Family Comparison**: Enhanced comparison tool supports analysis across completely different language families worldwide (Indo-European vs Amerindian vs Uralic vs Afroasiatic, etc.)
- **Professional Language Data**: All languages include authentic ISO codes, native names, speaker statistics, writing systems, endangerment status, and historical context

### Interactive Linguistic Mapping & Professional Database Integration (Previous)
- **Interactive Linguistic Map**: Enhanced language map with family connections, geographic visualization, and relationship networks
- **Language Family Connections**: Visual representation of linguistic relationships with color-coded family groupings and connection lines
- **Geographic Language Distribution**: Real-time mapping of languages with their authentic coordinates and regional clustering
- **Advanced Map Controls**: Zoom functionality, family filtering, connection toggles, and interactive language selection
- **Multi-API Integration**: Comprehensive integration with Wiktionary API, Merriam-Webster Dictionary API, and Free Dictionary API for authentic linguistic data
- **Real-Time Progress Tracking**: WebSocket-powered live updates during scraping operations with connection status monitoring
- **Quality Scoring System**: Confidence ratings and source attribution for translation accuracy assessment
- **Rate Limiting & Caching**: Intelligent request management with daily limits, caching, and fallback mechanisms for reliability
- **Linguistic Database Management**: Dashboard interface for testing APIs, monitoring service status, and viewing translation quality metrics
- **Enhanced Translation Process**: Professional linguistic data replaces mock translations with etymology, pronunciation, and definitions

### Previous Enhancements (December 2024)
- **Taxonomic Language Family Structure**: Implemented proper linguistic taxonomy (phylum → family → subfamily → branch → group → complex) with Indo-European hierarchy
- **Modern English Dialects**: Added American, British, and Australian English variants with geographic coordinates and historical context
- **Enhanced Statistics Dashboard**: Comprehensive stats showing counts by taxonomic level (phylums, families, subfamilies, branches, groups, complexes)
- **Interactive Language Map**: Geographic visualization component with coordinates, filters, and point-of-interest display for languages and families
- **Scraping Job Trigger**: UI-accessible button for starting word list scraping jobs with language selection and progress tracking

### Previous Features
- **Historical Language Variants**: Added support for chronological language evolution (Old English → Middle English → Early Modern English → Modern English) with regional distribution tracking  
- **Enhanced Language Tree**: Interactive expansion/collapse of historical variants with timeline context and regional information
- **Word List Comparison Tool**: Side-by-side comparison interface for analyzing word translations across multiple languages
- **Extended Language Detail Panel**: Comprehensive historical evolution section showing chronological variants with contextual information
- **Enhanced Data Schema**: Added fields for historical relationships, chronological ordering, temporal ranges, coordinates, and dialect classification

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite for development/build
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and Material Design shadows
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Key Features**:
  - Hierarchical language family tree browser with expand/collapse functionality
  - Advanced filtering by language status, region, and speaker count
  - Real-time scraping progress monitoring with status bar
  - Responsive design with mobile-first approach
  - Language detail panels with translation management

## Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **API Design**: RESTful API with structured error handling and request logging
- **Data Models**: 
  - Language families with hierarchical parent-child relationships
  - Languages with comprehensive metadata (ISO codes, speaker counts, regions)
  - Base word vocabulary system with position-based ordering
  - Word translations linking base words to specific languages
  - Scraping jobs for background translation processing
- **Storage Layer**: Abstracted storage interface for database operations

## Database Schema Design
- **Language Families**: Hierarchical structure with self-referencing parent relationships
- **Languages**: Rich metadata including ISO codes, geographic regions, speaker statistics
- **Base Words**: Core vocabulary with categorization and positioning
- **Word Translations**: Many-to-many relationship between base words and languages
- **Scraping Jobs**: Background job tracking with progress monitoring
- **Data Integrity**: Foreign key constraints and proper indexing for performance

## External Dependencies

- **Database**: PostgreSQL via Neon serverless database platform
- **UI Framework**: Radix UI for accessible component primitives
- **Form Handling**: React Hook Form with Zod schema validation
- **Development Tools**: 
  - Vite with React plugin for fast development
  - Replit-specific plugins for error overlay and cartographer
  - ESBuild for production bundling
- **Professional Linguistic APIs**: Multi-source integration for authentic translation data
  - **Wiktionary API**: Free multilingual dictionary with 280+ languages, etymologies, and pronunciation data
  - **Merriam-Webster Dictionary API**: Professional English dictionary with authoritative definitions and audio pronunciations
  - **Free Dictionary API**: Open-source English dictionary with phonetics and examples
  - **Rate Limiting**: Intelligent throttling with 100 requests/minute for public APIs, 1000/day for premium services
  - **Caching Strategy**: In-memory caching with automatic cache invalidation and fallback mechanisms
  - **Quality Assurance**: Confidence scoring system with source attribution and verification flags