-- Monitoring user with the privileges the README asks for.
CREATE USER database_collector PASSWORD 'collector-local';
GRANT pg_monitor TO database_collector;

-- Sample data so the tuple and size metrics have something to report.
CREATE TABLE orders (id serial PRIMARY KEY, note text);
INSERT INTO orders (note) SELECT 'order ' || g FROM generate_series(1, 10000) g;
DELETE FROM orders WHERE id % 4 = 0;
