import reportService from '../services/reportService.js';

export async function getSummary(req, res, next) {
  try {
    const data = await reportService.getSummary({ from: req.query.from, to: req.query.to });
    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
}

export default { getSummary };
