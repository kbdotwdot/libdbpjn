# API Endpoints

## Auth

### POST /api/register
SQL: `INSERT INTO users (...) VALUES (...) RETURNING user_id, first_name, last_name, email_address, role`
Frontend: register() in Register page

### POST /api/login
SQL: `SELECT * FROM users WHERE email_address = $1`
Frontend: login() in nav bar


## Users

### GET /api/users
SQL: `SELECT user_id, first_name, last_name, date_of_birth, phone_number, email_address, role FROM users ORDER BY user_id`
Frontend: available for librarian/admin

### GET /api/users/:id
SQL: `SELECT user_id, first_name, last_name, date_of_birth, phone_number, email_address, role FROM users WHERE user_id = $1`
Frontend: loadProfile() in Profile page

### PUT /api/users/:id/role
SQL: `UPDATE users SET role = $1 WHERE user_id = $2 RETURNING user_id, first_name, last_name, role`
Frontend: not directly used


## Book Details

### GET /api/book-details
SQL: `SELECT * FROM book_details ORDER BY title`
Frontend: not directly called

### GET /api/book-details/:isbn
SQL (3 queries):
1. `SELECT * FROM book_details WHERE isbn = $1`
2. `SELECT a.author_id, a.name FROM authors a JOIN book_authors ba ON a.author_id = ba.author_id WHERE ba.isbn = $1`
3. `SELECT g.genre_id, g.name FROM genres g JOIN book_genres bg ON g.genre_id = bg.genre_id WHERE bg.isbn = $1`
Frontend: showBookDetail() in Search page (when user clicks "details")

### POST /api/book-details
SQL:
1. `INSERT INTO book_details (isbn, title, publisher, publication_year, description) VALUES ($1, $2, $3, $4, $5)`
2. `INSERT INTO book_authors (isbn, author_id) VALUES ($1, $2)` (for each author)
3. `INSERT INTO book_genres (isbn, genre_id) VALUES ($1, $2)` (for each genre)
Frontend: addBookDetails() in For-Librarian page


## Authors

### GET /api/authors
SQL: `SELECT * FROM authors ORDER BY name`
Frontend: not directly called (shown through book details)

### POST /api/authors
SQL: `INSERT INTO authors (name) VALUES ($1) RETURNING *`
Frontend: addAuthor() in For-Librarian page


## Genres

### GET /api/genres
SQL: `SELECT * FROM genres ORDER BY name`
Frontend: not directly called (shown through book details)

### POST /api/genres
SQL: `INSERT INTO genres (name) VALUES ($1) RETURNING *`
Frontend: addGenre() in For-Librarian page


## Books (physical copies)

### GET /api/books
SQL: `SELECT b.book_id, b.isbn, b.copy_number, b.condition, b.status, bd.title, bd.publisher, bd.publication_year FROM books b JOIN book_details bd ON b.isbn = bd.isbn ORDER BY bd.title, b.copy_number`
Frontend: showBookDetail() in Search page (to list copies of a book)

### GET /api/books/available
SQL: same as above with `WHERE b.status = 'Available'`
Frontend: not directly called

### GET /api/books/:id
SQL: `SELECT b.book_id, b.isbn, b.copy_number, b.condition, b.status, bd.title, bd.publisher, bd.publication_year, bd.description FROM books b JOIN book_details bd ON b.isbn = bd.isbn WHERE b.book_id = $1`
Frontend: not directly called

### POST /api/books
SQL:
1. `SELECT isbn FROM book_details WHERE isbn = $1` (check ISBN exists)
2. `INSERT INTO books (isbn, copy_number, condition, status) VALUES ($1, $2, $3, 'Available') RETURNING *`
Frontend: addCopy() in For-Librarian page


## Search

### GET /api/search?q=...
SQL: `SELECT DISTINCT bd.isbn, bd.title, bd.publisher, bd.publication_year FROM book_details bd LEFT JOIN book_authors ba ON bd.isbn = ba.isbn LEFT JOIN authors a ON ba.author_id = a.author_id WHERE bd.title ILIKE $1 OR bd.isbn ILIKE $1 OR a.name ILIKE $1 ORDER BY bd.title`
Frontend: searchBooks() in Search page


## Borrow

### POST /api/borrow
SQL (5 queries):
1. `SELECT user_id, first_name, last_name FROM users WHERE user_id = $1` (check member exists)
2. `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('max_books_per_user', 'loan_period_days')` (get limits)
3. `SELECT COUNT(*) FROM borrow_records WHERE user_id = $1 AND return_date IS NULL` (check current borrows)
4. `SELECT book_id, status FROM books WHERE book_id = $1` (check availability)
5. `INSERT INTO borrow_records (user_id, book_id, borrow_date, due_date) VALUES ($1, $2, CURRENT_DATE, $3) RETURNING *`
6. `UPDATE books SET status = 'On Loan' WHERE book_id = $1`
Frontend: borrowBook() in For-Librarian page

### POST /api/return
SQL (up to 5 queries):
1. `SELECT * FROM borrow_records WHERE book_id = $1 AND return_date IS NULL` (find active borrow)
2. `UPDATE borrow_records SET return_date = $1 WHERE transaction_id = $2`
3. `UPDATE books SET status = 'Available' WHERE book_id = $1`
4. `SELECT setting_value FROM system_settings WHERE setting_key = 'fine_per_day'` (if late)
5. `INSERT INTO fines (transaction_id, amount, paid, date_issued) VALUES ($1, $2, false, CURRENT_DATE) RETURNING *` (if late)
Frontend: returnBook() in For-Librarian page

### GET /api/borrows
SQL: `SELECT br.*, u.first_name, u.last_name, bd.title FROM borrow_records br JOIN users u ON br.user_id = u.user_id JOIN books b ON br.book_id = b.book_id JOIN book_details bd ON b.isbn = bd.isbn ORDER BY br.borrow_date DESC`
Frontend: loadAllBorrows() in For-Librarian page

### GET /api/borrows/my
SQL: `SELECT br.*, bd.title FROM borrow_records br JOIN books b ON br.book_id = b.book_id JOIN book_details bd ON b.isbn = bd.isbn WHERE br.user_id = $1 ORDER BY br.borrow_date DESC`
Frontend: loadProfile() in Profile page


## Fines

### GET /api/fines
SQL: `SELECT f.*, u.first_name, u.last_name, bd.title FROM fines f JOIN borrow_records br ON f.transaction_id = br.transaction_id JOIN users u ON br.user_id = u.user_id JOIN books b ON br.book_id = b.book_id JOIN book_details bd ON b.isbn = bd.isbn ORDER BY f.date_issued DESC`
Frontend: loadAllFines() in For-Librarian page

### GET /api/fines/my
SQL: `SELECT f.*, bd.title FROM fines f JOIN borrow_records br ON f.transaction_id = br.transaction_id JOIN books b ON br.book_id = b.book_id JOIN book_details bd ON b.isbn = bd.isbn WHERE br.user_id = $1 ORDER BY f.date_issued DESC`
Frontend: loadProfile() in Profile page

### POST /api/fines/:id/pay
SQL: `UPDATE fines SET paid = true, date_paid = CURRENT_DATE WHERE fine_id = $1 AND paid = false RETURNING *`
Frontend: payFine() in For-Librarian page


## System Settings

### GET /api/settings
SQL: `SELECT * FROM system_settings ORDER BY setting_key`
Frontend: loadSettings() in For-Admin page

### PUT /api/settings/:key
SQL: `UPDATE system_settings SET setting_value = $1 WHERE setting_key = $2 RETURNING *`
Frontend: updateSetting() in For-Admin page


## Raw SQL

### POST /api/sql
SQL: whatever the admin types
Frontend: runSQL() in For-Admin page
