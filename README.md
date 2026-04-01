## Prerequisites

- Node.js (v18 or higher)
- A terminal (PowerShell on Windows)

## Installation

1. Clone or download this project.

2. Open a terminal in the project folder and run:

```
node Database/setup.js
```

This script will:
- Install PostgreSQL 16 via winget (if not already installed)
- Install all Node.js dependencies
- Create the `library_db` database and all tables
- Load sample data (13 users, 10 books, borrow records, fines)
- Generate a `.env` file with your database credentials

When prompted for your PostgreSQL password, enter the password you set during installation. The default is `postgres`.

3. Start the server:

```
node Backend/run.js
```

4. Open your browser and go to:

```
http://localhost:3000
```

