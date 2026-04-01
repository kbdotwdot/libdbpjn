// built for windows 11, node v24.14.0
// Didn't have enough time to check if this works on other machines.. This script might break so I'm hosting a ready-to-use demo,
// incase you cannot self-host this.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// where the project root is (one folder up from /Database)
const PROJECT_ROOT = path.resolve(__dirname, "..");

// database config
const DB_NAME = "library_db";
const DB_USER = "postgres";
const DB_PORT = 5432;
const DB_HOST = "localhost";


//  Helper: run a terminal command
function runCommand(command, folder) {
    if (!folder) folder = PROJECT_ROOT;

    console.log("  Running: " + command);

    try {
        execSync(command, { stdio: "inherit", cwd: folder });
    } catch (error) {
        return false;
    }

    return true;
}


// helper to quietly run a command and get the output as a string
function runQuiet(command) {
    try {
        let output = execSync(command, { stdio: "pipe", cwd: PROJECT_ROOT });
        return output.toString();
    } catch (error) {
        return "";
    }
}


// helper to ask the user a question
function askUser(question) {
    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(function (resolve) {
        rl.question(question, function (answer) {
            rl.close();
            resolve(answer);
        });
    });
}


//  Step 1: Install PostgreSQL 16
async function installPostgreSQL() {
    console.log("");
    console.log(" Step 1: PostgreSQL Installation");

    // check if psql command exists
    let psqlCheck = runQuiet("psql --version");

    if (psqlCheck) {
        console.log("  " + psqlCheck.trim());
        console.log("  PostgreSQL is already installed. Skipping.");
        return;
    }

    // use winget
    console.log("  PostgreSQL was not found on this computer.");
    console.log("");

    let answer = await askUser("  Do you want to install PostgreSQL 16? (y/n): ");

    if (answer.toLowerCase() !== "y") {
        console.log("  Skipped. You need PostgreSQL to continue.");
        process.exit(0);
    }

    // install with default superuser password "postgres"
    let installCmd = 'winget install PostgreSQL.PostgreSQL.16 --accept-source-agreements --accept-package-agreements'
        + ' --override "--superpassword postgres --serverport ' + DB_PORT + ' --enable-components server"';

    let success = runCommand(installCmd);

    if (!success) {
        console.log("  ERROR: PostgreSQL installation failed.");
        process.exit(1);
    }

    console.log("");
    console.log("  PostgreSQL 16 has been installed.");
    console.log("  Superuser password is: postgres");
    console.log("");
    console.log("  Please close this terminal, open a new one, and run this script again.");
    console.log("  (PostgreSQL needs to be on your PATH before we can continue.)");
    process.exit(0);
}


//  Step 2: Install Node.js packages
function installDependencies() {
    console.log("");
    console.log(" Step 2: Node.js Dependencies");

    // check if package.json exists, if not create one
    let packageJsonPath = path.join(PROJECT_ROOT, "package.json");

    if (!fs.existsSync(packageJsonPath)) {
        console.log("  No package.json found. Creating one...");
        let created = runCommand("npm init -y");
        if (!created) {
            console.log("  ERROR: Could not create package.json.");
            process.exit(1);
        }
    } else {
        console.log("  package.json already exists.");
    }

    console.log("");
    console.log("  Installing packages...");
    let installed = runCommand("npm install express pg cors dotenv bcryptjs jsonwebtoken");
    if (!installed) {
        console.log("  ERROR: Failed to install packages.");
        process.exit(1);
    }

    console.log("");
    console.log("  Installing dev packages...");
    let devInstalled = runCommand("npm install --save-dev nodemon");
    if (!devInstalled) {
        console.log("  ERROR: Failed to install dev packages.");
        process.exit(1);
    }

    console.log("");
    console.log("  Packages installed.");
}


//  Step 3: Create database and tables
async function setupDatabase() {
    console.log("");
    console.log(" Step 3: Create Database & Tables");

    // load the pg package (it was installed in step 2)
    let pg;
    try {
        pg = require("pg");
    } catch (error) {
        console.log("  ERROR: 'pg' package not found. Did Step 2 run properly?");
        process.exit(1);
    }

    // ask for the postgres password
    let password = await askUser("  Enter your PostgreSQL password: ");

    // connect to the default 'postgres' database first to create our database
    let client = new pg.Client({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: password,
        database: "postgres"
    });

    try {
        await client.connect();
        console.log("  Connected to PostgreSQL.");
    } catch (error) {
        console.log("  ERROR: Could not connect to PostgreSQL.");
        console.log("  Make sure PostgreSQL is running and your password is correct.");
        console.log("  " + error.message);
        process.exit(1);
    }

    // check if library_db already exists
    let checkDb = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [DB_NAME]
    );

    if (checkDb.rows.length > 0) {
        console.log("  Database '" + DB_NAME + "' already exists.");
    } else {
        console.log("  Creating database '" + DB_NAME + "'...");
        await client.query("CREATE DATABASE " + DB_NAME);
        console.log("  Database created.");
    }

    await client.end();

    // now connect to library_db to create the tables
    let libraryClient = new pg.Client({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: password,
        database: DB_NAME
    });

    await libraryClient.connect();
    console.log("  Connected to '" + DB_NAME + "'.");
    console.log("");
    console.log("  Creating tables...");

    // USERS
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id SERIAL PRIMARY KEY,
            first_name VARCHAR(100) NOT NULL,
            last_name VARCHAR(100) NOT NULL,
            date_of_birth DATE,
            phone_number VARCHAR(20),
            email_address VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'Member'
        )
    `);
    console.log("  - users");

    // BOOK DETAILS
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS book_details (
            isbn VARCHAR(13) PRIMARY KEY,
            title VARCHAR(300) NOT NULL,
            publisher VARCHAR(200),
            publication_year INTEGER,
            description TEXT
        )
    `);
    console.log("  - book_details");

    // AUTHORS
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS authors (
            author_id SERIAL PRIMARY KEY,
            name VARCHAR(200) NOT NULL
        )
    `);
    console.log("  - authors");

    // BOOK AUTHORS (many-to-many)
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS book_authors (
            isbn VARCHAR(13) REFERENCES book_details(isbn),
            author_id INTEGER REFERENCES authors(author_id),
            PRIMARY KEY (isbn, author_id)
        )
    `);
    console.log("  - book_authors");

    // GENRES
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS genres (
            genre_id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL
        )
    `);
    console.log("  - genres");

    // BOOK GENRES (many-to-many)
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS book_genres (
            isbn VARCHAR(13) REFERENCES book_details(isbn),
            genre_id INTEGER REFERENCES genres(genre_id),
            PRIMARY KEY (isbn, genre_id)
        )
    `);
    console.log("  - book_genres");

    // BOOKS (physical copies)
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS books (
            book_id SERIAL PRIMARY KEY,
            isbn VARCHAR(13) REFERENCES book_details(isbn),
            copy_number INTEGER NOT NULL,
            condition VARCHAR(50) DEFAULT 'Good',
            status VARCHAR(20) DEFAULT 'Available'
        )
    `);
    console.log("  - books");

    // BORROW RECORDS
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS borrow_records (
            transaction_id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(user_id),
            book_id INTEGER REFERENCES books(book_id),
            borrow_date DATE NOT NULL DEFAULT CURRENT_DATE,
            due_date DATE NOT NULL,
            return_date DATE
        )
    `);
    console.log("  - borrow_records");

    // FINES
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS fines (
            fine_id SERIAL PRIMARY KEY,
            transaction_id INTEGER REFERENCES borrow_records(transaction_id),
            amount DECIMAL(10, 2) NOT NULL,
            paid BOOLEAN DEFAULT false,
            date_issued DATE NOT NULL DEFAULT CURRENT_DATE,
            date_paid DATE
        )
    `);
    console.log("  - fines");

    // SYSTEM SETTINGS
    await libraryClient.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key VARCHAR(100) PRIMARY KEY,
            setting_value VARCHAR(255) NOT NULL,
            description TEXT
        )
    `);
    console.log("  - system_settings");

    // add default settings if the table is empty
    let existingSettings = await libraryClient.query("SELECT COUNT(*) FROM system_settings");
    let count = parseInt(existingSettings.rows[0].count);

    if (count === 0) {
        console.log("");
        console.log("  Adding default settings...");

        await libraryClient.query(`
            INSERT INTO system_settings (setting_key, setting_value, description) VALUES
            ('max_books_per_user', '4', 'Maximum number of books a member can borrow at once'),
            ('loan_period_days', '30', 'Number of days before a book is overdue'),
            ('fine_per_day', '2.00', 'Daily fine in dollars for late returns')
        `);

    } else {
        console.log("  Settings already exist.");
    }

    // load default data if users table is empty
    let existingUsers = await libraryClient.query("SELECT COUNT(*) FROM users");
    let userCount = parseInt(existingUsers.rows[0].count);

    if (userCount === 0) {
        console.log("");
        console.log("  Loading default data...");
        let loadDefaults = require("./defaults");
        await loadDefaults(libraryClient);
    } else {
        console.log("  Data already exists. Skipping defaults.");
    }

    // save the password for the .env file
    setupDatabase.password = password;

    await libraryClient.end();
    console.log("");
    console.log("  All tables created.");
}


//  Step 4: Create .env file
function generateEnvFile() {
    console.log("");
    console.log(" Step 4: Environment Config (.env)");

    let envPath = path.join(PROJECT_ROOT, ".env");

    let content = "";
    content += "DB_HOST=" + DB_HOST + "\n";
    content += "DB_PORT=" + DB_PORT + "\n";
    content += "DB_USER=" + DB_USER + "\n";
    content += "DB_PASSWORD=" + (setupDatabase.password || "") + "\n";
    content += "DB_NAME=" + DB_NAME + "\n";
    content += "\n";
    content += "SERVER_PORT=3000\n";
    content += "JWT_SECRET=library-jwt-secret-change-this-to-something-random\n";

    fs.writeFileSync(envPath, content);

    console.log("  .env file saved.");
}


//  Run all steps
async function main() {
    console.log("");
    console.log("  Library Database - Project Setup");

    await installPostgreSQL();
    installDependencies();
    await setupDatabase();
    generateEnvFile();

    console.log("");
    console.log("  Setup complete!");
    console.log("");
    console.log("  Database: " + DB_NAME + " on port " + DB_PORT);
    console.log("  Start the server with: node Backend/run.js");
    console.log("");
}

main();
