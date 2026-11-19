-- Run by the image as SYS in the root container on first start.
ALTER SESSION SET CONTAINER = FREEPDB1;

-- Monitoring user with the privileges the README asks for.
CREATE USER database_collector IDENTIFIED BY "collector-local";
GRANT CREATE SESSION, SELECT_CATALOG_ROLE TO database_collector;

-- Sample data in its own tablespace so the tablespace metrics have something to report.
CREATE TABLESPACE app DATAFILE 'app01.dbf' SIZE 10M AUTOEXTEND ON NEXT 10M MAXSIZE 200M;
CREATE USER app IDENTIFIED BY "app-local" DEFAULT TABLESPACE app QUOTA UNLIMITED ON app;
CREATE TABLE app.orders (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note VARCHAR2(100));
INSERT INTO app.orders (note) SELECT 'order ' || level FROM dual CONNECT BY level <= 10000;
COMMIT;
