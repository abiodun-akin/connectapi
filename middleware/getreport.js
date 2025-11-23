const mongoose = require('mongoose');

const getreport = async(req, res, next) => {
    try {
        const report = await mongoose.model('Report').findById(req.params.id);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        req.report = report;
        next();
    } catch (error) {
        console.error('Error fetching user:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
}   
module.exports = getreport;
