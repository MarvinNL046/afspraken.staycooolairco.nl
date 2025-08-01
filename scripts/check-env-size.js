#!/usr/bin/env node

/**
 * Check environment variable sizes to identify which ones might be causing
 * the AWS Lambda 4KB limit issue
 */

const { execSync } = require('child_process');

console.log('Checking environment variable sizes...\n');

try {
  // Get all environment variables from Netlify
  const output = execSync('netlify env:list --plain', { encoding: 'utf-8' });
  const lines = output.split('\n').filter(line => line.trim());
  
  let totalSize = 0;
  const envVars = [];
  
  // Parse environment variables
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length >= 3 && !lines[i].includes('environment variables')) {
      const name = parts[0];
      const value = parts.slice(1, -1).join(' ');
      const size = name.length + value.length + 2; // +2 for = and null terminator
      
      envVars.push({ name, size, value: value.substring(0, 50) + (value.length > 50 ? '...' : '') });
      totalSize += size;
    }
  }
  
  // Sort by size
  envVars.sort((a, b) => b.size - a.size);
  
  console.log('Top 10 largest environment variables:');
  console.log('=====================================');
  envVars.slice(0, 10).forEach(env => {
    console.log(`${env.name}: ${env.size} bytes`);
    console.log(`  Preview: ${env.value}`);
    console.log('');
  });
  
  console.log(`\nTotal size: ${totalSize} bytes (${(totalSize / 1024).toFixed(2)} KB)`);
  console.log(`AWS Lambda limit: 4096 bytes (4 KB)`);
  
  if (totalSize > 4096) {
    console.log(`\n⚠️  EXCEEDS LIMIT by ${totalSize - 4096} bytes (${((totalSize - 4096) / 1024).toFixed(2)} KB)`);
    
    console.log('\nRecommendations:');
    console.log('1. Remove duplicate VITE_* variables (use NEXT_PUBLIC_* instead)');
    console.log('2. Store large credentials in Netlify Functions instead of env vars');
    console.log('3. Use shorter variable names where possible');
    console.log('4. Remove any unused environment variables');
  } else {
    console.log('\n✅ Within AWS Lambda limit');
  }
  
} catch (error) {
  console.error('Error checking environment variables:', error.message);
  console.log('\nAlternative: Check your environment variables in the Netlify dashboard');
  console.log('Look for:');
  console.log('- Large JSON credentials (like GOOGLE_CALENDAR_CREDENTIALS)');
  console.log('- Duplicate variables (VITE_* and NEXT_PUBLIC_* versions)');
  console.log('- Unused variables that can be removed');
}