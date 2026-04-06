# Library Database Schema

## users
- user_id SERIAL PRIMARY KEY
- first_name VARCHAR(100) NOT NULL -- Full name as 1 field violates 1NF
- last_name VARCHAR(100) NOT NULL
- date_of_birth DATE
- phone_number VARCHAR(20)
- email_address VARCHAR(255) UNIQUE NOT NULL
- password VARCHAR(255) NOT NULL
- role VARCHAR(20) NOT NULL DEFAULT 'Member' — Member, Librarian, or Admin

## book_details
- isbn VARCHAR(13) PRIMARY KEY
- title VARCHAR(300) NOT NULL
- publisher VARCHAR(200)
- publication_year INTEGER
- description TEXT

## authors
- author_id SERIAL PRIMARY KEY -- For cases when it's common to have multiple authors in a book.
- name VARCHAR(200) NOT NULL

## book_authors
- isbn VARCHAR(13) FK → book_details(isbn)
- author_id INTEGER FK → authors(author_id)
- PRIMARY KEY (isbn, author_id)

## genres
- genre_id SERIAL PRIMARY KEY -- Similarily, a book can have multiple Genres.
- name VARCHAR(100) NOT NULL

## book_genres
- isbn VARCHAR(13) FK → book_details(isbn)
- genre_id INTEGER FK → genres(genre_id)
- PRIMARY KEY (isbn, genre_id)

## books
- book_id SERIAL PRIMARY KEY
- isbn VARCHAR(13) FK → book_details(isbn)
- copy_number INTEGER NOT NULL
- condition VARCHAR(50) DEFAULT 'Good'
- status VARCHAR(20) DEFAULT 'Available' — Available, On Loan, Lost, Damaged

## borrow_records
- transaction_id SERIAL PRIMARY KEY
- user_id INTEGER FK → users(user_id)
- book_id INTEGER FK → books(book_id)
- borrow_date DATE NOT NULL DEFAULT CURRENT_DATE
- due_date DATE NOT NULL
- return_date DATE — NULL until returned

## fines - This is needed for tracking fines, and not derived because I couldn't think of a way to differentiate paid and outstanding fines.
- fine_id SERIAL PRIMARY KEY
- transaction_id INTEGER FK → borrow_records(transaction_id)
- amount DECIMAL(10,2) NOT NULL
- paid BOOLEAN DEFAULT false
- date_issued DATE NOT NULL DEFAULT CURRENT_DATE
- date_paid DATE — NULL until paid

## system_settings - hotswappable settings so you don't have to redeploy everytime you change these values.
- setting_key VARCHAR(100) PRIMARY KEY
- setting_value VARCHAR(255) NOT NULL
- description TEXT

Defaults: max_books_per_user = 4, loan_period_days = 30, fine_per_day = 2.00
