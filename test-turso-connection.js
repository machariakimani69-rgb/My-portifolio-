#!/usr/bin/env node
/**
 * Turso Connection Test
 * Tests that the application can connect to a Turso/libSQL database
 * and perform basic CRUD operations.
 * 
 * Usage: node test-turso-connection.js
 * Required env vars: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */

const crypto = require('node:crypto');

async function testTursoConnection() {
  const { createClient } = require('@libsql/client');

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error('ERROR: TURSO_DATABASE_URL is not set');
    process.exit(1);
  }
  if (!token) {
    console.error('ERROR: TURSO_AUTH_TOKEN is not set');
    process.exit(1);
  }

  console.log('Testing Turso connection...');
  console.log('URL:', url.replace(/(libsql:\/\/)([^@]+@)/, '$1***@'));

  const client = createClient({ url, authToken: token });

  try {
    // Test 1: Basic query
    console.log('\n1. Testing basic query...');
    const result = await client.execute('SELECT 1 AS health_check');
    console.log('   Result:', result.rows[0]);
    if (result.rows[0].health_check !== 1) {
      throw new Error('Basic query returned unexpected result');
    }
    console.log('   PASS');

    // Test 2: Create table
    console.log('\n2. Testing table creation...');
    await client.execute(`
      CREATE TABLE IF NOT EXISTS _connection_test (
        id INTEGER PRIMARY KEY,
        test_value TEXT,
        created_at TEXT
      )
    `);
    console.log('   PASS');

    // Test 3: Insert
    console.log('\n3. Testing insert...');
    const testId = crypto.randomUUID();
    const testValue = `test-${Date.now()}`;
    await client.execute(
      'INSERT INTO _connection_test (id, test_value, created_at) VALUES (?, ?, ?)',
      [testId, testValue, new Date().toISOString()]
    );
    console.log('   PASS');

    // Test 4: Select
    console.log('\n4. Testing select...');
    const selectResult = await client.execute(
      'SELECT * FROM _connection_test WHERE id = ?',
      [testId]
    );
    if (selectResult.rows.length !== 1) {
      throw new Error('Expected 1 row, got ' + selectResult.rows.length);
    }
    if (selectResult.rows[0].test_value !== testValue) {
      throw new Error('Value mismatch');
    }
    console.log('   PASS');

    // Test 5: Update
    console.log('\n5. Testing update...');
    const updatedValue = `updated-${Date.now()}`;
    await client.execute(
      'UPDATE _connection_test SET test_value = ? WHERE id = ?',
      [updatedValue, testId]
    );
    const updateCheck = await client.execute(
      'SELECT test_value FROM _connection_test WHERE id = ?',
      [testId]
    );
    if (updateCheck.rows[0].test_value !== updatedValue) {
      throw new Error('Update verification failed');
    }
    console.log('   PASS');

    // Test 6: Delete
    console.log('\n6. Testing delete...');
    await client.execute('DELETE FROM _connection_test WHERE id = ?', [testId]);
    const deleteCheck = await client.execute(
      'SELECT * FROM _connection_test WHERE id = ?',
      [testId]
    );
    if (deleteCheck.rows.length !== 0) {
      throw new Error('Delete verification failed');
    }
    console.log('   PASS');

    // Test 7: Transaction
    console.log('\n7. Testing transaction...');
    const tx = await client.transaction('write');
    try {
      await tx.execute(
        'INSERT INTO _connection_test (id, test_value, created_at) VALUES (?, ?, ?)',
        [crypto.randomUUID(), 'tx-test', new Date().toISOString()]
      );
      await tx.execute(
        'INSERT INTO _connection_test (id, test_value, created_at) VALUES (?, ?, ?)',
        [crypto.randomUUID(), 'tx-test-2', new Date().toISOString()]
      );
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
    const txCheck = await client.execute(
      "SELECT COUNT(*) AS count FROM _connection_test WHERE test_value LIKE 'tx-test%'"
    );
    if (txCheck.rows[0].count !== 2) {
      throw new Error('Transaction verification failed');
    }
    console.log('   PASS');

    // Cleanup
    await client.execute('DELETE FROM _connection_test WHERE test_value LIKE \'tx-test%\'');
    await client.execute('DROP TABLE _connection_test');

    console.log('\n=== All Turso connection tests PASSED ===');
    return true;
  } catch (error) {
    console.error('\n=== Turso connection test FAILED ===');
    console.error('Error:', error.message);
    return false;
  } finally {
    client.close();
  }
}

testTursoConnection().then((success) => {
  process.exit(success ? 0 : 1);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});