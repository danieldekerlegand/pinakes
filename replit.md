# Overview

The Linguistic Family Tree is a full-stack TypeScript application designed for exploring language families, languages, and word translations. It provides an interactive tree-based visualization for browsing linguistic relationships, managing word translations, tracking historical language evolution, and offers comprehensive word list comparison tools. The system also includes advanced capabilities for contextual etymology exploration, historical word migration tracking, and comprehensive database population with authentic linguistic data, including a strong focus on Native American languages. The project aims to be a valuable resource for linguistic research, education, and cultural preservation.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite.
- **UI Components**: Shadcn/ui built on Radix UI primitives.
- **Styling**: Tailwind CSS with custom design tokens.
- **State Management**: TanStack Query (React Query).
- **Routing**: Wouter.
- **Key Features**: Hierarchical language family tree browser, advanced filtering, real-time scraping progress monitoring, responsive design, and language detail panels with translation management.

## Backend Architecture
- **Framework**: Express.js with TypeScript.
- **Database ORM**: Drizzle ORM with PostgreSQL dialect.
- **API Design**: RESTful API with structured error handling and request logging.
- **Data Models**: Hierarchical language families, languages with metadata, base word vocabulary, word translations, and scraping jobs.
- **Storage Layer**: Abstracted database operations.

## Database Schema Design
- **Normalized Taxonomic Structure**: An 8-level taxonomic hierarchy including Phylums, Families, Subfamilies, Branches, Groups, Main Languages, Historical Variants, and Modern Dialects, with proper foreign key relationships.
- **Supporting Tables**: Base Words, Word Translations, Scraping Jobs, Language Evolution, User Contributions, Translation Contexts, and Search Filters.
- **Data Integrity & Performance**: Foreign key constraints, flexible references (nullable foreign keys), indexing strategy, and automated migration/validation tools.
- **Etymology Database Schema**: Comprehensive tables for `etymologies`, `word_migrations`, and `etymological_networks` with metadata for historical word tracking, migration routes, cognate mapping, and phonetic/semantic evolution.

# External Dependencies

- **Database**: PostgreSQL via Neon serverless database platform.
- **UI Framework**: Radix UI.
- **Form Handling**: React Hook Form with Zod schema validation.
- **Development Tools**: Vite, Replit-specific plugins, ESBuild.
- **Professional Linguistic APIs**:
    - **Wiktionary API**: For multilingual dictionary data, etymologies, and pronunciation.
    - **Merriam-Webster Dictionary API**: For authoritative English definitions.
    - **Free Dictionary API**: For open-source English dictionary data.
- **Rate Limiting & Caching**: Intelligent request management with caching, rate limiting, and fallback mechanisms for reliability and performance.