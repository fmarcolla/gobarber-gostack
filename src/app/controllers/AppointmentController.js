import * as Yup from 'yup';
import { startOfHour, parseISO, isBefore, format, subHours } from 'date-fns';
import pt from 'date-fns/locale/pt';
import Appointment from '../models/Appointment';
import User from '../models/User';
import File from '../models/File';
import Notification from '../schemas/Notification';
import Queue from '../../lib/Queue';
import CancellationMail from '../jobs/CancellationMail';

class AppointmentController {
  async index(req, res) {
    const { page = 1 } = req.query;

    const appointments = await Appointment.findAll({
      where: { user_id: req.userId, canceled_at: null },
      order: ['date'],
      attributes: ['id', 'date', 'past', 'cancelable'],
      limit: 20,
      offset: (page - 1) * 20,
      include: {
        model: User,
        as: 'provider',
        attributes: ['name', 'id'],
        include: [
          {
            model: File,
            as: 'avatar',
            attributes: ['id', 'url', 'path']
          }
        ]
      }
    });

    return res.json(appointments);
  }

  async store(req, res) {
    const schema = Yup.object().shape({
      date: Yup.date().required(),
      provider_id: Yup.number().required()
    });

    if (!(await schema.isValid(req.body))) {
      return res.status(400).json({ error: 'Validation failed' });
    }

    const { provider_id, date } = req.body;

    const user = await User.findByPk(req.userId);

    if (user.provider) {
      return res
        .status(401)
        .json({ error: 'Provider can t create an appointment!' });
    }

    const isProvider = await User.findOne({
      where: { id: provider_id, provider: true }
    });

    if (!isProvider) {
      return res.status(401).json({ error: 'User is not a provider' });
    }

    const hourStart = startOfHour(parseISO(date));

    // verifica se a data do agendamento é maior que a data atual
    if (isBefore(hourStart, new Date())) {
      return res.status(400).json({ error: 'Past date is not permited' });
    }

    // verifica a disponibilidade do horário marcado
    const checkAvaliability = await Appointment.findOne({
      where: {
        canceled_at: null,
        provider_id,
        date: hourStart
      }
    });

    if (checkAvaliability) {
      return res
        .status(400)
        .json({ error: 'Appointment date is not avaliabled' });
    }

    const appointment = await Appointment.create({
      user_id: req.userId,
      provider_id,
      date
    });

    const formattedDate = format(
      hourStart,
      "'dia' dd 'de' MMMM', às ' H:mm'h'",
      { locale: pt }
    );

    // grava notificação no mongoDB pra enviar pro provider.

    await Notification.create({
      content: `Novo agendamento de ${user.name} para ${formattedDate}`,
      user: provider_id
    });

    return res.json(appointment);
  }

  async delete(req, res) {
    const appointment = await Appointment.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['name', 'email']
        },
        {
          model: User,
          as: 'user',
          attributes: ['name']
        }
      ]
    });

    if (appointment.user_id !== req.userId) {
      return res.status(401).json({
        error: "You don't have permission to delete this appointment"
      });
    }

    const dateWithSub = subHours(appointment.date, 2);

    if (isBefore(dateWithSub, new Date())) {
      return res.status(401).json({
        error: "You can't only cancel appointments 2 hours in advance"
      });
    }

    appointment.canceled_at = new Date();
    await appointment.save();

    await Queue.add(CancellationMail.key, {
      appointment
    });

    return res.json(appointment);
  }
}

export default new AppointmentController();
