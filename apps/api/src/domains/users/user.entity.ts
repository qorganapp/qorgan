import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 32 })
  username: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'varchar', nullable: true, select: false })
  refreshTokenHash: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
