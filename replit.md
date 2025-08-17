# Overview

The Linguistic Family Tree is a full-stack TypeScript application for exploring language families, languages, and word translations. The system provides an interactive tree-based visualization for browsing linguistic relationships, managing word translations across languages, and includes a background scraping system for automated data collection. Built with React frontend, Express backend, and PostgreSQL database.

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
- **Translation APIs**: Extensible system supporting multiple translation services
  - Mock translation service for development
  - Google Translate API integration (configurable)
  - Designed for easy addition of other translation providers