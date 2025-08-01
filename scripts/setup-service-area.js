#!/usr/bin/env node

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function setupServiceArea() {
  console.log('🔧 Setting up Limburg service area...\n');

  try {
    // Check if Limburg service area already exists
    const existingArea = await prisma.serviceArea.findFirst({
      where: { name: 'Limburg' }
    });

    if (existingArea) {
      console.log('✅ Limburg service area already exists');
      console.log(`   Calendar Color ID: ${existingArea.calendarColorId || 'Not set'}`);
      
      // Update to ensure yellow color is set
      if (existingArea.calendarColorId !== '5') {
        await prisma.serviceArea.update({
          where: { id: existingArea.id },
          data: { calendarColorId: '5' }
        });
        console.log('   Updated calendar color to Yellow (ID: 5)');
      }
    } else {
      // Create new service area
      const newArea = await prisma.serviceArea.create({
        data: {
          name: 'Limburg',
          province: 'Limburg',
          isActive: true,
          calendarColorId: '5', // Yellow for sales team
          salesPersonName: 'Verkoop Team'
        }
      });
      
      console.log('✅ Created Limburg service area');
      console.log(`   ID: ${newArea.id}`);
      
      // Create postal code range
      await prisma.postalCodeRange.create({
        data: {
          serviceAreaId: newArea.id,
          startCode: '5800',
          endCode: '6999'
        }
      });
      
      console.log('   Postal codes: 5800-6999');
      console.log('   Calendar color: Yellow (ID: 5)');
    }

    console.log('\n📍 Major cities in service area:');
    const majorCities = [
      'Maastricht (6211)', 'Heerlen (6411)', 'Sittard-Geleen (6131)',
      'Venlo (5911)', 'Roermond (6041)', 'Weert (6001)'
    ];
    
    majorCities.forEach(city => {
      console.log(`   ✓ ${city}`);
    });

    console.log('\n🎉 Service area setup complete!');
    console.log('   The enhanced booking form will now:');
    console.log('   - Accept addresses in Limburg (5800-6999)');
    console.log('   - Filter for yellow calendar appointments');
    console.log('   - Optimize routes within 20km radius');

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

setupServiceArea();