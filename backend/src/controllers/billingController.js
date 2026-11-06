import invoiceRepository from '../repositories/invoiceRepository.js';

export async function listInvoices(req, res, next) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const patientId = req.query.patientId || null;

    const result = await invoiceRepository.getInvoices({ page, pageSize, patientId });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default {
  listInvoices,
};
