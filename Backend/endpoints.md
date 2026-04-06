# Chapter 4 — Logical Design

## 4.1 Query Design (by use case)

### 4.1.1 User Registration
Purpose: Create a new member account.
SQL: `INSERT INTO users (...) VALUES (...) RETURNING user_id, first_name, last_name, email_address, role`
Interface: Register form (Frontend → Register page, `register()`)

### 4.1.2 User Login
Purpose: Authenticate user credentials.
SQL: `SELECT * FROM users WHERE email_address = $1`
Interface: Login form (top navigation bar, `login()`)

### 4.1.3 View All Users (librarian/admin)
Purpose: View all registered users.
SQL: `SELECT user_id, first_name, last_name, date_of_birth, phone_number, email_address, role FROM users ORDER BY user_id`
Interface: Not directly used in UI (available to librarians/admins)

### 4.1.4 View My Profile
Purpose: Show the logged‑in user's profile.
SQL: `SELECT user_id, first_name, last_name, date_of_birth, phone_number, email_address, role FROM users WHERE user_id = $1`
Interface: Profile page (`loadProfile()`)

### 4.1.5 Update User Role (admin)
Purpose: Promote or demote a user role.
SQL: `UPDATE users SET role = $1 WHERE user_id = $2 RETURNING user_id, first_name, last_name, role`
Interface: Not directly used in UI (available via admin SQL)

### 4.1.6 Search Books
Purpose: Search by title, ISBN, or author.
SQL: `SELECT DISTINCT bd.isbn, bd.title, bd.publisher, bd.publication_year FROM book_details bd LEFT JOIN book_authors ba ON bd.isbn = ba.isbn LEFT JOIN authors a ON ba.author_id = a.author_id WHERE bd.title ILIKE $1 OR bd.isbn ILIKE $1 OR a.name ILIKE $1 ORDER BY bd.title`
Interface: Search page (`searchBooks()`)

### 4.1.7 View Book Details
Purpose: Show a book, its authors, and genres.
SQL:
- `SELECT * FROM book_details WHERE isbn = $1`
- `SELECT a.author_id, a.name FROM authors a JOIN book_authors ba ON a.author_id = ba.author_id WHERE ba.isbn = $1`
- `SELECT g.genre_id, g.name FROM genres g JOIN book_genres bg ON g.genre_id = bg.genre_id WHERE bg.isbn = $1`
Interface: Search page → details (`showBookDetail()`)

### 4.1.8 List Physical Copies
Purpose: Show all copies of a book and their availability.
SQL: `SELECT b.book_id, b.isbn, b.copy_number, b.condition, b.status, bd.title, bd.publisher, bd.publication_year FROM books b JOIN book_details bd ON b.isbn = bd.isbn ORDER BY bd.title, b.copy_number`
Interface: Search page → details (`showBookDetail()`)

### 4.1.9 Add Book Details (librarian/admin)
Purpose: Add a new title by ISBN.
SQL:
- `INSERT INTO book_details (isbn, title, publisher, publication_year, description) VALUES ($1, $2, $3, $4, $5)`
- `INSERT INTO book_authors (isbn, author_id) VALUES ($1, $2)` (per author)
- `INSERT INTO book_genres (isbn, genre_id) VALUES ($1, $2)` (per genre)
Interface: For‑Librarian page (`addBookDetails()`)

### 4.1.10 Add Physical Copy (librarian/admin)
Purpose: Add a new physical copy of an existing ISBN.
SQL:
- `SELECT isbn FROM book_details WHERE isbn = $1`
- `INSERT INTO books (isbn, copy_number, condition, status) VALUES ($1, $2, $3, 'Available') RETURNING *`
Interface: For‑Librarian page (`addCopy()`)

### 4.1.11 Add Author (librarian/admin)
Purpose: Add a new author.
SQL: `INSERT INTO authors (name) VALUES ($1) RETURNING *`
Interface: For‑Librarian page (`addAuthor()`)

### 4.1.12 Add Genre (librarian/admin)
Purpose: Add a new genre.
SQL: `INSERT INTO genres (name) VALUES ($1) RETURNING *`
Interface: For‑Librarian page (`addGenre()`)

### 4.1.13 Borrow a Book (librarian)
Purpose: Check out a book for a member and update status.
SQL:
- `SELECT user_id, first_name, last_name FROM users WHERE user_id = $1`
- `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('max_books_per_user', 'loan_period_days')`
- `SELECT COUNT(*) FROM borrow_records WHERE user_id = $1 AND return_date IS NULL`
- `SELECT book_id, status FROM books WHERE book_id = $1`
- `INSERT INTO borrow_records (user_id, book_id, borrow_date, due_date) VALUES ($1, $2, CURRENT_DATE, $3) RETURNING *`
- `UPDATE books SET status = 'On Loan' WHERE book_id = $1`
Interface: For‑Librarian page (`borrowBook()`)

### 4.1.14 Return a Book (librarian)
Purpose: Close a borrow record and calculate fine if late.
SQL:
- `SELECT * FROM borrow_records WHERE book_id = $1 AND return_date IS NULL`
- `UPDATE borrow_records SET return_date = $1 WHERE transaction_id = $2`
- `UPDATE books SET status = 'Available' WHERE book_id = $1`
- `SELECT setting_value FROM system_settings WHERE setting_key = 'fine_per_day'`
- `INSERT INTO fines (transaction_id, amount, paid, date_issued) VALUES ($1, $2, false, CURRENT_DATE) RETURNING *`
Interface: For‑Librarian page (`returnBook()`)

### 4.1.15 View Borrow Records (librarian/admin)
Purpose: View all transactions.
SQL: `SELECT br.*, u.first_name, u.last_name, bd.title FROM borrow_records br JOIN users u ON br.user_id = u.user_id JOIN books b ON br.book_id = b.book_id JOIN book_details bd ON b.isbn = bd.isbn ORDER BY br.borrow_date DESC`
Interface: For‑Librarian page (`loadAllBorrows()`)

### 4.1.16 View My Borrow Records
Purpose: Show a member's own borrow history.
SQL: `SELECT br.*, bd.title FROM borrow_records br JOIN books b ON br.book_id = b.book_id JOIN book_details bd ON b.isbn = bd.isbn WHERE br.user_id = $1 ORDER BY br.borrow_date DESC`
Interface: Profile page (`loadProfile()`)

### 4.1.17 View Fines (librarian/admin)
Purpose: View all fines.
SQL: `SELECT f.*, u.first_name, u.last_name, bd.title FROM fines f JOIN borrow_records br ON f.transaction_id = br.transaction_id JOIN users u ON br.user_id = u.user_id JOIN books b ON br.book_id = b.book_id JOIN book_details bd ON b.isbn = bd.isbn ORDER BY f.date_issued DESC`
Interface: For‑Librarian page (`loadAllFines()`)

### 4.1.18 View My Fines
Purpose: Show a member's own fines.
SQL: `SELECT f.*, bd.title FROM fines f JOIN borrow_records br ON f.transaction_id = br.transaction_id JOIN books b ON br.book_id = b.book_id JOIN book_details bd ON b.isbn = bd.isbn WHERE br.user_id = $1 ORDER BY f.date_issued DESC`
Interface: Profile page (`loadProfile()`)

### 4.1.19 Mark Fine as Paid (librarian/admin)
Purpose: Update a fine to paid.
SQL: `UPDATE fines SET paid = true, date_paid = CURRENT_DATE WHERE fine_id = $1 AND paid = false RETURNING *`
Interface: For‑Librarian page (`payFine()`)

### 4.1.20 View System Settings (admin)
Purpose: Read current system settings.
SQL: `SELECT * FROM system_settings ORDER BY setting_key`
Interface: For‑Admin page (`loadSettings()`)

### 4.1.21 Update System Settings (admin)
Purpose: Change max books, loan period, fine rate.
SQL: `UPDATE system_settings SET setting_value = $1 WHERE setting_key = $2 RETURNING *`
Interface: For‑Admin page (`updateSetting()`)

### 4.1.22 Run Raw SQL (admin)
Purpose: Run any SQL query for admin/demo.
SQL: Arbitrary SQL typed by admin.
Interface: For‑Admin page (`runSQL()`)


## 4.2 Applications (Forms and Reports)

### Forms (data input/update)
- Register account
- Borrow book (librarian)
- Return book (librarian)
- Add book details (librarian/admin)
- Add physical copy (librarian/admin)
- Add author (librarian/admin)
- Add genre (librarian/admin)
- Mark fine as paid (librarian/admin)
- Update system settings (admin)
- Run raw SQL (admin)

### Reports (data output)
- Book search results
- Book details (including authors, genres, copies)
- User profile
- Borrow history (member)
- Borrow records list (librarian/admin)
- Fine list (member)
- Fine list (librarian/admin)
- System settings list (admin)
