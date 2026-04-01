var express = require("express");
var cors = require("cors");
var dotenv = require("dotenv");
var path = require("path");
var pg = require("pg");
var { Pool } = pg;
var bcrypt = require("bcryptjs");

// tell pg to return DATE columns as plain strings like "2000-01-15"
// instead of converting them into JavaScript Date objects (which adds timezone)
pg.types.setTypeParser(1082, function (value) { return value; });
var jwt = require("jsonwebtoken");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

var app = express();
app.use(cors());
app.use(express.json());

var JWT_SECRET = process.env.JWT_SECRET || "wawaadotwdotmrrpmrrpmiaw";

// ========================================
//  Database connection
// ========================================

var pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});


// middleware for auth 

// this reads the token from the request header and attaches user info to req.user
function authenticate(req, res, next) {
    var header = req.headers.authorization;

    if (!header) {
        return res.status(401).json({ error: "No token provided" });
    }

    // token format: "Bearer <token>"
    var token = header.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "No token provided" });
    }

    try {
        var decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid token" });
    }
}

// check if the logged-in user has one of the allowed roles
function requireRole(allowedRoles) {
    return function (req, res, next) {
        if (!req.user) {
            return res.status(401).json({ error: "Not logged in" }); // same for this.
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: "You don't have permission to do this" }); // should fail silently in real cases to prevent port scanning but it's just a demo.
        }

        next();
    };
}


// ========================================
//  AUTH ROUTES
// ========================================

// POST /api/register
app.post("/api/register", async function (req, res) {
    try {
        var { first_name, last_name, date_of_birth, phone_number, email_address, password, role } = req.body;

        if (!first_name || !last_name || !email_address || !password) {
            return res.status(400).json({ error: "first_name, last_name, email_address, and password are required" });
        }

        // only allow Member role for self-registration
        // admins can change roles later
        if (!role) role = "Member";

        // hash the password
        var hashedPassword = await bcrypt.hash(password, 10);

        var result = await pool.query(
            `INSERT INTO users (first_name, last_name, date_of_birth, phone_number, email_address, password, role)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING user_id, first_name, last_name, email_address, role`,
            [first_name, last_name, date_of_birth || null, phone_number || null, email_address, hashedPassword, role]
        );

        var user = result.rows[0];

        res.status(201).json({ message: "User registered", user: user });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(400).json({ error: "That email is already registered" });
        }
        console.log("Register error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// POST /api/login
app.post("/api/login", async function (req, res) {
    try {
        var { email_address, password } = req.body;

        if (!email_address || !password) {
            return res.status(400).json({ error: "email_address and password are required" });
        }

        // find the user by email
        var result = await pool.query(
            "SELECT * FROM users WHERE email_address = $1",
            [email_address]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        var user = result.rows[0];

        // check the password
        var passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        // create a token
        var token = jwt.sign(
            { user_id: user.user_id, email_address: user.email_address, role: user.role },
            JWT_SECRET,
            { expiresIn: "24h" }
        );

        res.json({
            message: "Login successful",
            token: token,
            user: {
                user_id: user.user_id,
                first_name: user.first_name,
                last_name: user.last_name,
                email_address: user.email_address,
                role: user.role
            }
        });

    } catch (error) {
        console.log("Login error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  USER ROUTES
// ========================================

// GET /api/users - list all users (admin and librarian only)
app.get("/api/users", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var result = await pool.query(
            "SELECT user_id, first_name, last_name, date_of_birth, phone_number, email_address, role FROM users ORDER BY user_id"
        );
        res.json(result.rows);
    } catch (error) {
        console.log("Get users error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// GET /api/users/:id - get one user
app.get("/api/users/:id", authenticate, async function (req, res) {
    try {
        var userId = req.params.id;

        // members can only view their own profile
        if (req.user.role === "Member" && req.user.user_id !== parseInt(userId)) {
            return res.status(403).json({ error: "You can only view your own profile" });
        }

        var result = await pool.query(
            "SELECT user_id, first_name, last_name, date_of_birth, phone_number, email_address, role FROM users WHERE user_id = $1",
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.log("Get user error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// PUT /api/users/:id/role - change a user's role (admin only)
app.put("/api/users/:id/role", authenticate, requireRole(["Admin"]), async function (req, res) {
    try {
        var userId = req.params.id;
        var { role } = req.body;

        if (!role || !["Member", "Librarian", "Admin"].includes(role)) {
            return res.status(400).json({ error: "role must be Member, Librarian, or Admin" });
        }

        var result = await pool.query(
            "UPDATE users SET role = $1 WHERE user_id = $2 RETURNING user_id, first_name, last_name, role",
            [role, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({ message: "Role updated", user: result.rows[0] });
    } catch (error) {
        console.log("Update role error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  BOOK DETAILS ROUTES
// ========================================

// GET /api/book-details - list all book details
app.get("/api/book-details", async function (req, res) {
    try {
        var result = await pool.query("SELECT * FROM book_details ORDER BY title");
        res.json(result.rows);
    } catch (error) {
        console.log("Get book details error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// GET /api/book-details/:isbn - get one book with its authors and genres
app.get("/api/book-details/:isbn", async function (req, res) {
    try {
        var isbn = req.params.isbn;

        // get the book details
        var bookResult = await pool.query(
            "SELECT * FROM book_details WHERE isbn = $1",
            [isbn]
        );

        if (bookResult.rows.length === 0) {
            return res.status(404).json({ error: "Book not found" });
        }

        var book = bookResult.rows[0];

        // get the authors for this book
        var authorsResult = await pool.query(
            "SELECT a.author_id, a.name FROM authors a JOIN book_authors ba ON a.author_id = ba.author_id WHERE ba.isbn = $1",
            [isbn]
        );

        // get the genres for this book
        var genresResult = await pool.query(
            "SELECT g.genre_id, g.name FROM genres g JOIN book_genres bg ON g.genre_id = bg.genre_id WHERE bg.isbn = $1",
            [isbn]
        );

        book.authors = authorsResult.rows;
        book.genres = genresResult.rows;

        res.json(book);
    } catch (error) {
        console.log("Get book detail error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// POST /api/book-details - add a new book (librarian/admin)
app.post("/api/book-details", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var { isbn, title, publisher, publication_year, description, author_ids, genre_ids } = req.body;

        if (!isbn || !title) {
            return res.status(400).json({ error: "isbn and title are required" });
        }

        // insert the book details
        await pool.query(
            "INSERT INTO book_details (isbn, title, publisher, publication_year, description) VALUES ($1, $2, $3, $4, $5)",
            [isbn, title, publisher || null, publication_year || null, description || null]
        );

        // link authors if provided
        if (author_ids && author_ids.length > 0) {
            for (var i = 0; i < author_ids.length; i++) {
                await pool.query(
                    "INSERT INTO book_authors (isbn, author_id) VALUES ($1, $2)",
                    [isbn, author_ids[i]]
                );
            }
        }

        // link genres if provided
        if (genre_ids && genre_ids.length > 0) {
            for (var i = 0; i < genre_ids.length; i++) {
                await pool.query(
                    "INSERT INTO book_genres (isbn, genre_id) VALUES ($1, $2)",
                    [isbn, genre_ids[i]]
                );
            }
        }

        res.status(201).json({ message: "Book details added", isbn: isbn });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(400).json({ error: "A book with that ISBN already exists" });
        }
        console.log("Add book details error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  AUTHORS ROUTES
// ========================================

// GET /api/authors
app.get("/api/authors", async function (req, res) {
    try {
        var result = await pool.query("SELECT * FROM authors ORDER BY name");
        res.json(result.rows);
    } catch (error) {
        console.log("Get authors error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});

// POST /api/authors - add a new author (librarian/admin)
app.post("/api/authors", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: "name is required" });
        }

        var result = await pool.query(
            "INSERT INTO authors (name) VALUES ($1) RETURNING *",
            [name]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.log("Add author error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  GENRES ROUTES
// ========================================

// GET /api/genres
app.get("/api/genres", async function (req, res) {
    try {
        var result = await pool.query("SELECT * FROM genres ORDER BY name");
        res.json(result.rows);
    } catch (error) {
        console.log("Get genres error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});

// POST /api/genres - add a new genre (librarian/admin)
app.post("/api/genres", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: "name is required" });
        }

        var result = await pool.query(
            "INSERT INTO genres (name) VALUES ($1) RETURNING *",
            [name]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.log("Add genre error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  BOOKS ROUTES (physical copies)
// ========================================

// GET /api/books - list all physical copies with their book details
app.get("/api/books", async function (req, res) {
    try {
        var result = await pool.query(
            `SELECT b.book_id, b.isbn, b.copy_number, b.condition, b.status,
                    bd.title, bd.publisher, bd.publication_year
             FROM books b
             JOIN book_details bd ON b.isbn = bd.isbn
             ORDER BY bd.title, b.copy_number`
        );
        res.json(result.rows);
    } catch (error) {
        console.log("Get books error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// GET /api/books/available - list only available copies
app.get("/api/books/available", async function (req, res) {
    try {
        var result = await pool.query(
            `SELECT b.book_id, b.isbn, b.copy_number, b.condition, b.status,
                    bd.title, bd.publisher, bd.publication_year
             FROM books b
             JOIN book_details bd ON b.isbn = bd.isbn
             WHERE b.status = 'Available'
             ORDER BY bd.title, b.copy_number`
        );
        res.json(result.rows);
    } catch (error) {
        console.log("Get available books error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// GET /api/books/:id - get one physical copy
app.get("/api/books/:id", async function (req, res) {
    try {
        var bookId = req.params.id;

        var result = await pool.query(
            `SELECT b.book_id, b.isbn, b.copy_number, b.condition, b.status,
                    bd.title, bd.publisher, bd.publication_year, bd.description
             FROM books b
             JOIN book_details bd ON b.isbn = bd.isbn
             WHERE b.book_id = $1`,
            [bookId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Book not found" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.log("Get book error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// POST /api/books - add a new physical copy (librarian/admin)
app.post("/api/books", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var { isbn, copy_number, condition } = req.body;

        if (!isbn || !copy_number) {
            return res.status(400).json({ error: "isbn and copy_number are required" });
        }

        // make sure the isbn exists in book_details
        var bookCheck = await pool.query("SELECT isbn FROM book_details WHERE isbn = $1", [isbn]);
        if (bookCheck.rows.length === 0) {
            return res.status(400).json({ error: "No book details found for that ISBN. Add book details first." });
        }

        var result = await pool.query(
            "INSERT INTO books (isbn, copy_number, condition, status) VALUES ($1, $2, $3, 'Available') RETURNING *",
            [isbn, copy_number, condition || "Good"]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.log("Add book error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  SEARCH ROUTE
// ========================================

// GET /api/search?q=something - search books by title, author, or isbn
app.get("/api/search", async function (req, res) {
    try {
        var searchTerm = req.query.q;

        if (!searchTerm) {
            return res.status(400).json({ error: "Please provide a search term with ?q=..." });
        }

        var searchPattern = "%" + searchTerm + "%";

        var result = await pool.query(
            `SELECT DISTINCT bd.isbn, bd.title, bd.publisher, bd.publication_year
             FROM book_details bd
             LEFT JOIN book_authors ba ON bd.isbn = ba.isbn
             LEFT JOIN authors a ON ba.author_id = a.author_id
             WHERE bd.title ILIKE $1
                OR bd.isbn ILIKE $1
                OR a.name ILIKE $1
             ORDER BY bd.title`,
            [searchPattern]
        );

        res.json(result.rows);
    } catch (error) {
        console.log("Search error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  BORROW ROUTES
// ========================================

// POST /api/borrow - librarian checks out a book for a member
app.post("/api/borrow", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var { user_id, book_id } = req.body;

        if (!user_id || !book_id) {
            return res.status(400).json({ error: "user_id and book_id are required" });
        }

        // make sure the user exists
        var userCheck = await pool.query("SELECT user_id, first_name, last_name FROM users WHERE user_id = $1", [user_id]);
        if (userCheck.rows.length === 0) {
            return res.status(404).json({ error: "Member not found" });
        }

        var userId = user_id;

        // get the system settings we need
        var settingsResult = await pool.query(
            "SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('max_books_per_user', 'loan_period_days')"
        );

        var maxBooks = 4;
        var loanDays = 30;

        for (var i = 0; i < settingsResult.rows.length; i++) {
            if (settingsResult.rows[i].setting_key === "max_books_per_user") {
                maxBooks = parseInt(settingsResult.rows[i].setting_value);
            }
            if (settingsResult.rows[i].setting_key === "loan_period_days") {
                loanDays = parseInt(settingsResult.rows[i].setting_value);
            }
        }

        // check how many books the user currently has borrowed
        var borrowCount = await pool.query(
            "SELECT COUNT(*) FROM borrow_records WHERE user_id = $1 AND return_date IS NULL",
            [userId]
        );

        var currentlyBorrowed = parseInt(borrowCount.rows[0].count);

        if (currentlyBorrowed >= maxBooks) {
            return res.status(400).json({
                error: "This member already has " + currentlyBorrowed + " books borrowed. Maximum is " + maxBooks + "."
            });
        }

        // check if the book is available
        var bookResult = await pool.query(
            "SELECT book_id, status FROM books WHERE book_id = $1",
            [book_id]
        );

        if (bookResult.rows.length === 0) {
            return res.status(404).json({ error: "Book not found" });
        }

        if (bookResult.rows[0].status !== "Available") {
            return res.status(400).json({ error: "This book is not available. Current status: " + bookResult.rows[0].status });
        }

        // calculate the due date
        var today = new Date();
        var dueDate = new Date(today);
        dueDate.setDate(dueDate.getDate() + loanDays);

        // create the borrow record
        var borrowResult = await pool.query(
            "INSERT INTO borrow_records (user_id, book_id, borrow_date, due_date) VALUES ($1, $2, CURRENT_DATE, $3) RETURNING *",
            [userId, book_id, dueDate.toISOString().split("T")[0]]
        );

        // update the book status to "On Loan"
        await pool.query(
            "UPDATE books SET status = 'On Loan' WHERE book_id = $1",
            [book_id]
        );

        res.status(201).json({
            message: "Book borrowed successfully",
            borrow_record: borrowResult.rows[0]
        });

    } catch (error) {
        console.log("Borrow error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// POST /api/return - librarian processes a book return
app.post("/api/return", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var { book_id } = req.body;

        if (!book_id) {
            return res.status(400).json({ error: "book_id is required" });
        }

        // find the active borrow record for this book
        var borrowResult = await pool.query(
            "SELECT * FROM borrow_records WHERE book_id = $1 AND return_date IS NULL",
            [book_id]
        );

        if (borrowResult.rows.length === 0) {
            return res.status(400).json({ error: "This book is not currently borrowed" });
        }

        var borrowRecord = borrowResult.rows[0];
        var today = new Date();
        var todayString = today.toISOString().split("T")[0];

        // update the borrow record with the return date
        await pool.query(
            "UPDATE borrow_records SET return_date = $1 WHERE transaction_id = $2",
            [todayString, borrowRecord.transaction_id]
        );

        // update the book status back to "Available"
        await pool.query(
            "UPDATE books SET status = 'Available' WHERE book_id = $1",
            [book_id]
        );

        // check if the book is late
        var dueDate = new Date(borrowRecord.due_date);
        var fine = null;

        if (today > dueDate) {
            // calculate how many days late
            var timeDiff = today.getTime() - dueDate.getTime();
            var daysLate = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

            // get the fine rate from settings
            var fineRateResult = await pool.query(
                "SELECT setting_value FROM system_settings WHERE setting_key = 'fine_per_day'"
            );

            var finePerDay = 2.00;
            if (fineRateResult.rows.length > 0) {
                finePerDay = parseFloat(fineRateResult.rows[0].setting_value);
            }

            var fineAmount = daysLate * finePerDay;

            // create a fine record
            var fineResult = await pool.query(
                "INSERT INTO fines (transaction_id, amount, paid, date_issued) VALUES ($1, $2, false, CURRENT_DATE) RETURNING *",
                [borrowRecord.transaction_id, fineAmount]
            );

            fine = fineResult.rows[0];
            fine.days_late = daysLate;
        }

        var response = {
            message: "Book returned successfully",
            return_date: todayString
        };

        if (fine) {
            response.message = "Book returned late";
            response.fine = fine;
        }

        res.json(response);

    } catch (error) {
        console.log("Return error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// GET /api/borrows - list all borrow records (librarian/admin)
app.get("/api/borrows", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var result = await pool.query(
            `SELECT br.*, u.first_name, u.last_name, bd.title
             FROM borrow_records br
             JOIN users u ON br.user_id = u.user_id
             JOIN books b ON br.book_id = b.book_id
             JOIN book_details bd ON b.isbn = bd.isbn
             ORDER BY br.borrow_date DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.log("Get borrows error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// GET /api/borrows/my - list my borrow records
app.get("/api/borrows/my", authenticate, async function (req, res) {
    try {
        var result = await pool.query(
            `SELECT br.*, bd.title
             FROM borrow_records br
             JOIN books b ON br.book_id = b.book_id
             JOIN book_details bd ON b.isbn = bd.isbn
             WHERE br.user_id = $1
             ORDER BY br.borrow_date DESC`,
            [req.user.user_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.log("Get my borrows error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  FINES ROUTES
// ========================================

// GET /api/fines - list all fines (librarian/admin)
app.get("/api/fines", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var result = await pool.query(
            `SELECT f.*, u.first_name, u.last_name, bd.title
             FROM fines f
             JOIN borrow_records br ON f.transaction_id = br.transaction_id
             JOIN users u ON br.user_id = u.user_id
             JOIN books b ON br.book_id = b.book_id
             JOIN book_details bd ON b.isbn = bd.isbn
             ORDER BY f.date_issued DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.log("Get fines error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// GET /api/fines/my - list my fines
app.get("/api/fines/my", authenticate, async function (req, res) {
    try {
        var result = await pool.query(
            `SELECT f.*, bd.title
             FROM fines f
             JOIN borrow_records br ON f.transaction_id = br.transaction_id
             JOIN books b ON br.book_id = b.book_id
             JOIN book_details bd ON b.isbn = bd.isbn
             WHERE br.user_id = $1
             ORDER BY f.date_issued DESC`,
            [req.user.user_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.log("Get my fines error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// POST /api/fines/:id/pay - mark a fine as paid (librarian/admin)
app.post("/api/fines/:id/pay", authenticate, requireRole(["Admin", "Librarian"]), async function (req, res) {
    try {
        var fineId = req.params.id;

        var result = await pool.query(
            "UPDATE fines SET paid = true, date_paid = CURRENT_DATE WHERE fine_id = $1 AND paid = false RETURNING *",
            [fineId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Fine not found or already paid" });
        }

        res.json({ message: "Fine marked as paid", fine: result.rows[0] });
    } catch (error) {
        console.log("Pay fine error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// ========================================
//  SYSTEM SETTINGS ROUTES
// ========================================

// GET /api/settings - get all settings
app.get("/api/settings", authenticate, requireRole(["Admin"]), async function (req, res) {
    try {
        var result = await pool.query("SELECT * FROM system_settings ORDER BY setting_key");
        res.json(result.rows);
    } catch (error) {
        console.log("Get settings error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// PUT /api/settings/:key - update a setting (admin only)
app.put("/api/settings/:key", authenticate, requireRole(["Admin"]), async function (req, res) {
    try {
        var settingKey = req.params.key;
        var { setting_value } = req.body;

        if (!setting_value) {
            return res.status(400).json({ error: "setting_value is required" });
        }

        var result = await pool.query(
            "UPDATE system_settings SET setting_value = $1 WHERE setting_key = $2 RETURNING *",
            [setting_value, settingKey]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Setting not found" });
        }

        res.json({ message: "Setting updated", setting: result.rows[0] });
    } catch (error) {
        console.log("Update setting error:", error.message);
        res.status(500).json({ error: "Something went wrong" });
    }
});


// POST /api/sql - run a raw SQL query (admin only, for demo purposes)
app.post("/api/sql", authenticate, requireRole(["Admin"]), async function (req, res) {
    try {
        var { query } = req.body;

        if (!query) {
            return res.status(400).json({ error: "query is required" });
        }

        var result = await pool.query(query);

        res.json({
            command: result.command,
            rowCount: result.rowCount,
            rows: result.rows || []
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});


// ========================================
//  SERVE FRONTEND
// ========================================

app.use(express.static(path.join(__dirname, "..", "Frontend")));


// ========================================
//  START SERVER
// ========================================

var PORT = process.env.SERVER_PORT || 3000;

app.listen(PORT, function () {
    console.log("");
    console.log("==========================================");
    console.log("  Library API running on port " + PORT);
    console.log("==========================================");
    console.log("");
    console.log("  Public:");
    console.log("    POST /api/register");
    console.log("    POST /api/login");
    console.log("    GET  /api/book-details");
    console.log("    GET  /api/book-details/:isbn");
    console.log("    GET  /api/books");
    console.log("    GET  /api/books/available");
    console.log("    GET  /api/books/:id");
    console.log("    GET  /api/search?q=...");
    console.log("    GET  /api/authors");
    console.log("    GET  /api/genres");
    console.log("");
    console.log("  Members (logged in):");
    console.log("    GET  /api/users/:id          (own profile)");
    console.log("    GET  /api/borrows/my");
    console.log("    GET  /api/fines/my");
    console.log("");
    console.log("  Librarians:");
    console.log("    POST /api/borrow             (check out book for a member)");
    console.log("    POST /api/return             (process a return)");
    console.log("    GET  /api/borrows");
    console.log("    GET  /api/fines");
    console.log("    POST /api/fines/:id/pay");
    console.log("    POST /api/book-details");
    console.log("    POST /api/books");
    console.log("    POST /api/authors");
    console.log("    POST /api/genres");
    console.log("    GET  /api/users");
    console.log("");
    console.log("  Admin:");
    console.log("    PUT  /api/users/:id/role");
    console.log("    GET  /api/settings");
    console.log("    PUT  /api/settings/:key");
    console.log("");
});
