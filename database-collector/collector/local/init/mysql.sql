-- Monitoring user with the privileges the README asks for. Used by MySQL and MariaDB.
CREATE USER 'database_collector'@'%' IDENTIFIED BY 'collector-local';
GRANT PROCESS, SHOW VIEW ON *.* TO 'database_collector'@'%';

-- Sample schema so SchemaSizeBytes has something to report.
CREATE DATABASE app;
CREATE TABLE app.orders (id int AUTO_INCREMENT PRIMARY KEY, note varchar(100));
INSERT INTO app.orders (note) VALUES ('first'), ('second'), ('third');
