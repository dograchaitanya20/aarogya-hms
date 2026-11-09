import { z } from 'zod';
import appointmentService from '../services/appointmentService.js';
import { parsePagination } from '../utils/pagination.js';

const bookSchema = z.object({
  patientId: z.string().uuid('Valid patient UUID required'),
  doctorId: z.string().uuid('Valid doctor UUID required'),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  reasonForVisit: z.string().optional(),
});

const rescheduleSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  expectedVersion: z.number().int().positive(),
});

const statusSchema = z.object({
  status: z.enum(['scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show']),
  cancellationReason: z.string().optional(),
  expectedStatus: z.enum(['scheduled', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show']).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export async function book(req, res, next) {
  try {
    const validated = bookSchema.parse(req.body);
    const appointment = await appointmentService.bookAppointment({
      ...validated,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });

    res.status(201).json({
      message: 'Appointment booked successfully',
      data: appointment,
    });
  } catch (err) {
    next(err);
  }
}

export async function list(req, res, next) {
  try {
    const { status, doctorId, patientId, from, to, q } = req.query;
    const { page, pageSize } = parsePagination(req.query, 20);

    const result = await appointmentService.getAppointments(
      { status, doctorId, patientId, from, to, q, page, pageSize },
      req.user
    );

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getById(req, res, next) {
  try {
    const appointment = await appointmentService.getAppointmentById(req.params.id, req.user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
    });
    res.status(200).json({ data: appointment });
  } catch (err) {
    next(err);
  }
}

export async function reschedule(req, res, next) {
  try {
    const validated = rescheduleSchema.parse(req.body);
    const updated = await appointmentService.rescheduleAppointment({
      id: req.params.id,
      ...validated,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });

    res.status(200).json({
      message: 'Appointment rescheduled successfully',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateStatus(req, res, next) {
  try {
    const validated = statusSchema.parse(req.body);
    const updated = await appointmentService.updateStatus({
      id: req.params.id,
      ...validated,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });

    res.status(200).json({
      message: 'Appointment status updated successfully',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export default {
  book,
  list,
  getById,
  reschedule,
  updateStatus,
};
