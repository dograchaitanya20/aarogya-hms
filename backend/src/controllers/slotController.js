import slotService from '../services/slotService.js';
import { parsePagination } from '../utils/pagination.js';

export async function searchSlots(req, res, next) {
  try {
    const { doctorId, departmentId, from, to } = req.query;
    const { page, pageSize } = parsePagination(req.query, 50);

    const result = await slotService.computeAvailableSlots({
      doctorId: doctorId || null,
      departmentId: departmentId || null,
      fromDateStr: from,
      toDateStr: to,
      page,
      pageSize,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getDoctorSlots(req, res, next) {
  try {
    const { id } = req.params;
    const { date } = req.query;

    const slots = await slotService.getDoctorSlotsForDate(id, date);
    res.status(200).json({ data: slots });
  } catch (err) {
    next(err);
  }
}

export default {
  searchSlots,
  getDoctorSlots,
};
