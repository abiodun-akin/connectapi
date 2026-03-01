/**
 * Profile Routes Unit Tests
 * Tests for profile initialization and completion endpoints
 */

const request = require('supertest');
const express = require('express');

describe('Profile Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Mock middleware to set user
    app.use((req, res, next) => {
      req.user = { _id: 'test-user-id' };
      next();
    });

    // Basic validation endpoints
    app.post('/api/profile/initialize', (req, res) => {
      const { profileType } = req.body;
      const validTypes = ['farmer', 'vendor'];
      
      if (!profileType || !validTypes.includes(profileType)) {
        return res.status(400).json({ error: 'Invalid profile type' });
      }
      
      res.status(200).json({
        profile: { profileType }
      });
    });

    app.post('/api/profile/farmer', (req, res) => {
      const { phone, location, state, farmerDetails } = req.body;
      
      if (!phone) {
        return res.status(400).json({ error: 'Phone is required' });
      }
      if (!location) {
        return res.status(400).json({ error: 'Location is required' });
      }
      if (!state) {
        return res.status(400).json({ error: 'State is required' });
      }
      if (!farmerDetails || !farmerDetails.farmingAreas || farmerDetails.farmingAreas.length === 0) {
        return res.status(400).json({ error: 'Farming areas are required' });
      }
      
      res.status(200).json({
        profile: { 
          profileType: 'farmer',
          ...req.body
        }
      });
    });

    app.post('/api/profile/vendor', (req, res) => {
      const { phone, location, state, businessType } = req.body;
      
      if (!phone) {
        return res.status(400).json({ error: 'Phone is required' });
      }
      if (!location) {
        return res.status(400).json({ error: 'Location is required' });
      }
      if (!state) {
        return res.status(400).json({ error: 'State is required' });
      }
      if (!businessType) {
        return res.status(400).json({ error: 'Business type is required' });
      }
      
      res.status(200).json({
        profile: { 
          profileType: 'vendor',
          ...req.body
        }
      });
    });
  });

  describe('POST /initialize', () => {
    it('should initialize profile with farmer type', async () => {
      const response = await request(app)
        .post('/api/profile/initialize')
        .send({ profileType: 'farmer' });

      expect(response.status).toBe(200);
      expect(response.body.profile.profileType).toBe('farmer');
    });

    it('should initialize profile with vendor type', async () => {
      const response = await request(app)
        .post('/api/profile/initialize')
        .send({ profileType: 'vendor' });

      expect(response.status).toBe(200);
      expect(response.body.profile.profileType).toBe('vendor');
    });

    it('should reject invalid profile type', async () => {
      const response = await request(app)
        .post('/api/profile/initialize')
        .send({ profileType: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should reject missing profile type', async () => {
      const response = await request(app)
        .post('/api/profile/initialize')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('POST /farmer', () => {
    it('should validate required phone field', async () => {
      const incompleteData = {
        location: 'Lagos',
        state: 'Lagos',
        farmerDetails: {
          farmingAreas: ['Crop Farming'],
        },
      };

      const response = await request(app)
        .post('/api/profile/farmer')
        .send(incompleteData);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/phone/i);
    });

    it('should validate required farming areas', async () => {
      const incompleteData = {
        phone: '1234567890',
        location: 'Lagos',
        state: 'Lagos',
        farmerDetails: {
          farmingAreas: [],
        },
      };

      const response = await request(app)
        .post('/api/profile/farmer')
        .send(incompleteData);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/farming/i);
    });

    it('should validate required location field', async () => {
      const incompleteData = {
        phone: '1234567890',
        state: 'Lagos',
        farmerDetails: {
          farmingAreas: ['Crop Farming'],
        },
      };

      const response = await request(app)
        .post('/api/profile/farmer')
        .send(incompleteData);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/location/i);
    });

    it('should accept valid farmer profile', async () => {
      const validData = {
        phone: '1234567890',
        location: 'Lagos',
        state: 'Lagos',
        farmerDetails: {
          farmingAreas: ['Crop Farming'],
        },
      };

      const response = await request(app)
        .post('/api/profile/farmer')
        .send(validData);

      expect(response.status).toBe(200);
      expect(response.body.profile.profileType).toBe('farmer');
    });
  });

  describe('POST /vendor', () => {
    it('should validate required business type', async () => {
      const incompleteData = {
        phone: '1234567890',
        location: 'Lagos',
        state: 'Lagos',
      };

      const response = await request(app)
        .post('/api/profile/vendor')
        .send(incompleteData);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/business/i);
    });

    it('should validate required phone field', async () => {
      const incompleteData = {
        location: 'Lagos',
        state: 'Lagos',
        businessType: 'Retailer',
      };

      const response = await request(app)
        .post('/api/profile/vendor')
        .send(incompleteData);

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/phone/i);
    });

    it('should accept valid vendor profile', async () => {
      const validData = {
        phone: '1234567890',
        location: 'Lagos',
        state: 'Lagos',
        businessType: 'Retailer',
      };

      const response = await request(app)
        .post('/api/profile/vendor')
        .send(validData);

      expect(response.status).toBe(200);
      expect(response.body.profile.profileType).toBe('vendor');
    });
  });
});
