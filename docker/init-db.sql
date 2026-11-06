-- Create test database if it does not exist
SELECT 'CREATE DATABASE aarogya_hms_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aarogya_hms_test')\gexec
