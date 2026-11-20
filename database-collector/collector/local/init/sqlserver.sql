-- Run as sa by the command in compose.yaml each time the container starts, so it must be safe to
-- run again.

-- Monitoring login with the privileges the README asks for.
IF SUSER_ID('database_collector') IS NULL
  CREATE LOGIN database_collector WITH PASSWORD = 'collector-local', CHECK_POLICY = OFF;
GRANT VIEW SERVER STATE, VIEW ANY DEFINITION TO database_collector;
GO

-- Sample database so DatabaseSizeBytes has something to report.
IF DB_ID('app') IS NULL
  CREATE DATABASE app;
GO
USE app;
IF OBJECT_ID('dbo.orders') IS NULL
BEGIN
  CREATE TABLE dbo.orders (id int IDENTITY PRIMARY KEY, note varchar(100));
  INSERT INTO dbo.orders (note)
  SELECT TOP (10000) concat('order ', row_number() OVER (ORDER BY (SELECT NULL)))
  FROM sys.all_objects a CROSS JOIN sys.all_objects b;
END
GO
